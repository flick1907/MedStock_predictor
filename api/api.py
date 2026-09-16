from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional, List
import os
import pickle
import ssl
import jwt
from pathlib import Path
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func

from api.database import (
    init_db, get_db, Prediction, User, StockRequest, verify_password
)

try:
    import certifi
except ImportError:
    certifi = None

app = FastAPI(title="MedStock Predictor API", version="1.0.0")

JWT_SECRET = os.getenv("JWT_SECRET", "your-super-secret-jwt-key")
JWT_ALGORITHM = "HS256"


@app.on_event("startup")
def startup_db_client():
    try:
        init_db()
    except Exception as e:
        print(f"Warning: Database initialization failed: {e}")


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", BASE_DIR / "model" / "model_rf.pkl"))
MODEL_URL = os.getenv(
    "MODEL_URL",
    "https://huggingface.co/lavesh1919/MedStock_predictor/resolve/main/model_rf.pkl",
)
LIVE_DATA_PATH = Path(os.getenv("LIVE_DATA_PATH", BASE_DIR / "model" / "live_data.csv"))
cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGIN", "").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_model_available():
    if MODEL_PATH.exists():
        return

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    request = Request(MODEL_URL, headers={"User-Agent": "MedStock-Predictor/1.0"})
    temporary_path = MODEL_PATH.with_suffix(f"{MODEL_PATH.suffix}.download")
    ssl_context = ssl.create_default_context(cafile=certifi.where()) if certifi else None
    try:
        with urlopen(request, timeout=120, context=ssl_context) as response, temporary_path.open("wb") as model_file:
            while chunk := response.read(1024 * 1024):
                model_file.write(chunk)
        temporary_path.replace(MODEL_PATH)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise RuntimeError(f"Unable to download model from {MODEL_URL}")


ensure_model_available()
with MODEL_PATH.open("rb") as model_file:
    model = pickle.load(model_file)


# ── Auth Helper Functions ────────────────────────────────────
def create_access_token(user: User) -> str:
    payload = {
        "sub": user.username,
        "role": user.role,
        "user_id": user.id,
        "name": user.full_name,
        "exp": datetime.now(timezone.utc) + timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> Optional[User]:
    if not authorization:
        return None
    try:
        token = authorization.replace("Bearer ", "").strip()
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username = payload.get("sub")
        if username:
            return db.query(User).filter(User.username == username).first()
    except Exception:
        pass
    return None


# ── Pydantic Request Models ──────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str


class predict_request(BaseModel):
    medicine_name: str = Field(..., min_length=1, max_length=40, example="Diclofenac")
    atc_code: str = Field(..., min_length=2, max_length=20, example="M01AB")
    past_7_day_sales: int = Field(..., ge=0, example=30)
    past_30_day_avg_sales: float = Field(..., ge=0, example=4.25)
    current_stock: int = Field(..., ge=0, example=146)
    days_to_expiry: int = Field(..., ge=0, example=317)
    price_per_unit: int = Field(..., gt=0, example=150)

    live_temp: Optional[float] = Field(default=None, example=25.7)
    live_humidity: Optional[float] = Field(default=None, example=47.5)
    is_rainy: Optional[int] = Field(default=None, ge=0, le=1, example=0)
    fever_trend: Optional[int] = Field(default=None, ge=0, le=100, example=28)
    allergy_trend: Optional[int] = Field(default=None, ge=0, le=100, example=31)


class response_model(BaseModel):
    medicine_name: str
    next_7_day_demand: int = Field(..., ge=0, description="Predicted demand for next 7 days")
    days_to_reorder: int = Field(..., ge=0, description="Stock will last for X days")
    reorder_quantity: int = Field(..., ge=0, description="How much to order")
    expiry_risk: str = Field(..., example="Low")
    live_data_used: dict


class StockCreateRequest(BaseModel):
    medicine_name: str
    requested_quantity: int = Field(..., gt=0)
    urgency: str = Field(default="Medium")
    notes: Optional[str] = None


class StockUpdateRequest(BaseModel):
    status: str  # APPROVED, FULFILLED, REJECTED


def get_live_data():
    try:
        live_df = pd.read_csv(LIVE_DATA_PATH)
        row = live_df.iloc[-1].to_dict()
        return row
    except Exception:
        return {
            'live_temp': 26.5, 'live_humidity': 70.0, 'is_rainy': 0,
            'fever_trend': 30, 'allergy_trend': 25
        }


# ── Auth Endpoints ───────────────────────────────────────────
@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username.strip()).first()
    if not user or not verify_password(user.password_hash, req.password.strip()):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_access_token(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user.to_dict()
    }


@app.get("/auth/me")
def get_me(user: Optional[User] = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user.to_dict()


# ── Prediction Endpoints ─────────────────────────────────────
@app.post("/predict", response_model=response_model)
def predict(req: predict_request, db: Session = Depends(get_db)):
    live = get_live_data()

    live_temp     = req.live_temp     if req.live_temp     is not None else live['live_temp']
    live_humidity = req.live_humidity if req.live_humidity is not None else live['live_humidity']
    is_rainy      = req.is_rainy      if req.is_rainy      is not None else live['is_rainy']
    fever_trend   = req.fever_trend   if req.fever_trend   is not None else live['fever_trend']
    allergy_trend = req.allergy_trend if req.allergy_trend is not None else live['allergy_trend']

    current_month = datetime.now().month

    features = [[
        req.past_7_day_sales,
        req.past_30_day_avg_sales,
        req.current_stock,
        req.days_to_expiry,
        req.price_per_unit,
        live_temp,
        live_humidity,
        is_rainy,
        fever_trend,
        allergy_trend,
        current_month,
    ]]

    try:
        pred_demand = int(model.predict(features)[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model prediction failed: {e}")

    daily_avg = req.past_30_day_avg_sales if req.past_30_day_avg_sales > 0 else 1
    next_7_day_demand = pred_demand

    days_to_reorder = int(req.current_stock / daily_avg)

    monthly_demand = int((pred_demand / 7) * 30)
    reorder_quantity = max(0, monthly_demand - req.current_stock)

    if req.days_to_expiry < 30:
        expiry_risk = "High"
    elif req.days_to_expiry < 90:
        expiry_risk = "Medium"
    else:
        expiry_risk = "Low"

    try:
        db_record = Prediction(
            medicine_name=req.medicine_name,
            atc_code=req.atc_code,
            past_7_day_sales=req.past_7_day_sales,
            past_30_day_avg_sales=req.past_30_day_avg_sales,
            current_stock=req.current_stock,
            days_to_expiry=req.days_to_expiry,
            price_per_unit=float(req.price_per_unit),
            live_temp=float(live_temp),
            live_humidity=float(live_humidity),
            is_rainy=int(is_rainy),
            fever_trend=int(fever_trend),
            allergy_trend=int(allergy_trend),
            next_7_day_demand=next_7_day_demand,
            days_to_reorder=days_to_reorder,
            reorder_quantity=reorder_quantity,
            expiry_risk=expiry_risk
        )
        db.add(db_record)
        db.commit()
        db.refresh(db_record)
    except Exception as db_err:
        db.rollback()
        print(f"Failed to persist prediction to database: {db_err}")

    return response_model(
        medicine_name=req.medicine_name,
        next_7_day_demand=next_7_day_demand,
        days_to_reorder=days_to_reorder,
        reorder_quantity=reorder_quantity,
        expiry_risk=expiry_risk,
        live_data_used={
            "live_temp": live_temp,
            "live_humidity": live_humidity,
            "is_rainy": is_rainy,
            "fever_trend": fever_trend,
            "allergy_trend": allergy_trend,
            "month": current_month,
        }
    )


@app.get("/predictions")
def get_predictions(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    records = db.query(Prediction).order_by(Prediction.created_at.desc()).offset(offset).limit(limit).all()
    return [r.to_dict() for r in records]


# ── Owner Analytics Endpoint ──────────────────────────────────
@app.get("/analytics/owner")
def get_owner_analytics(db: Session = Depends(get_db)):
    all_preds = db.query(Prediction).order_by(Prediction.created_at.desc()).all()

    # If database is empty, return initial analytics structure
    total_records = len(all_preds)
    past_7_day_sales = sum(p.past_7_day_sales for p in all_preds) if all_preds else 0
    past_30_day_sales = sum(int(p.past_30_day_avg_sales * 30) for p in all_preds) if all_preds else 0
    total_forecast_demand = sum(p.next_7_day_demand for p in all_preds) if all_preds else 0
    total_stock_in_inventory = sum(p.current_stock for p in all_preds) if all_preds else 0

    expiry_risk_counts = {"Low": 0, "Medium": 0, "High": 0}
    for p in all_preds:
        risk = p.expiry_risk if p.expiry_risk in expiry_risk_counts else "Low"
        expiry_risk_counts[risk] += 1

    # Medicine performance breakdown
    medicine_stats = {}
    for p in all_preds:
        med = p.medicine_name
        if med not in medicine_stats:
            medicine_stats[med] = {
                "medicine_name": med,
                "atc_code": p.atc_code,
                "past_7_day_sales": p.past_7_day_sales,
                "past_30_day_sales": int(p.past_30_day_avg_sales * 30),
                "current_stock": p.current_stock,
                "predicted_7_day_demand": p.next_7_day_demand,
                "reorder_quantity": p.reorder_quantity,
                "expiry_risk": p.expiry_risk,
                "days_to_reorder": p.days_to_reorder
            }

    med_list = list(medicine_stats.values())
    top_demanded = sorted(med_list, key=lambda x: x["predicted_7_day_demand"], reverse=True)[:7]
    low_stock = [m for m in med_list if m["days_to_reorder"] <= 14 or m["current_stock"] < m["predicted_7_day_demand"]]

    pending_requests = db.query(StockRequest).filter(StockRequest.status == "PENDING").count()

    # Time series / timeline data
    timeline = []
    for p in reversed(all_preds[:10]):
        dt_str = p.created_at.strftime("%b %d, %H:%M") if p.created_at else "Recent"
        timeline.append({
            "label": f"{p.medicine_name} ({dt_str})",
            "past_7_sales": p.past_7_day_sales,
            "forecast_demand": p.next_7_day_demand,
            "current_stock": p.current_stock,
        })

    return {
        "summary": {
            "total_records": total_records,
            "past_7_day_sales": past_7_day_sales,
            "past_30_day_sales": past_30_day_sales,
            "total_forecast_demand": total_forecast_demand,
            "total_stock_in_inventory": total_stock_in_inventory,
            "pending_stock_requests": pending_requests,
        },
        "expiry_risk_counts": expiry_risk_counts,
        "top_demanded_medicines": top_demanded,
        "low_stock_alerts": low_stock,
        "timeline": timeline,
        "all_medicines_summary": med_list
    }


# ── Inventory & Stock Request Endpoints ──────────────────────
@app.get("/inventory")
def get_inventory(db: Session = Depends(get_db)):
    all_preds = db.query(Prediction).order_by(Prediction.created_at.desc()).all()
    inventory = {}
    for p in all_preds:
        if p.medicine_name not in inventory:
            inventory[p.medicine_name] = p.to_dict()
    return list(inventory.values())


@app.post("/stock-requests")
def create_stock_request(
    req: StockCreateRequest,
    user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    requested_by_id = user.id if user else None
    requested_by_name = user.full_name if user else "Staff Member"

    stock_req = StockRequest(
        medicine_name=req.medicine_name.strip(),
        requested_quantity=req.requested_quantity,
        urgency=req.urgency,
        notes=req.notes,
        status="PENDING",
        requested_by_id=requested_by_id,
        requested_by_name=requested_by_name
    )
    db.add(stock_req)
    db.commit()
    db.refresh(stock_req)
    return stock_req.to_dict()


@app.get("/stock-requests")
def list_stock_requests(db: Session = Depends(get_db)):
    requests = db.query(StockRequest).order_by(StockRequest.created_at.desc()).all()
    return [r.to_dict() for r in requests]


@app.patch("/stock-requests/{request_id}")
def update_stock_request(
    request_id: int,
    body: StockUpdateRequest,
    user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    stock_req = db.query(StockRequest).filter(StockRequest.id == request_id).first()
    if not stock_req:
        raise HTTPException(status_code=404, detail="Stock request not found")

    valid_statuses = ["PENDING", "APPROVED", "FULFILLED", "REJECTED"]
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Choose from {valid_statuses}")

    old_status = stock_req.status
    stock_req.status = body.status

    # If status transitioned to FULFILLED, automatically add requested quantity to current stock!
    if body.status == "FULFILLED" and old_status != "FULFILLED":
        latest_pred = db.query(Prediction).filter(
            func.lower(Prediction.medicine_name) == stock_req.medicine_name.lower()
        ).order_by(Prediction.created_at.desc()).first()

        if latest_pred:
            latest_pred.current_stock += stock_req.requested_quantity
            daily_avg = latest_pred.past_30_day_avg_sales if latest_pred.past_30_day_avg_sales > 0 else 1.0
            latest_pred.days_to_reorder = int(latest_pred.current_stock / daily_avg)
            monthly_demand = int((latest_pred.next_7_day_demand / 7) * 30)
            latest_pred.reorder_quantity = max(0, monthly_demand - latest_pred.current_stock)

    db.commit()
    db.refresh(stock_req)
    return stock_req.to_dict()


@app.get("/health")
def health():
    return {"status": "ok"}


app.mount("/", StaticFiles(directory=BASE_DIR / "frontend", html=True), name="frontend")