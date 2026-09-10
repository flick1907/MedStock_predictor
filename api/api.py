from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional
import os
import pickle
import ssl
from pathlib import Path
from datetime import datetime   # fix: import class directly so datetime.now() works
from urllib.request import Request, urlopen
import pandas as pd

try:
    import certifi
except ImportError:
    certifi = None

app = FastAPI(title="MedStock Predictor API", version="1.0.0")

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
    allow_origins=cors_origins,
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


class predict_request(BaseModel):
    # required input parameters compulsorily for prediction
    medicine_name: str = Field(..., min_length=1, max_length=40, example="Diclofenac")
    atc_code: str = Field(..., min_length=2, max_length=20, example="M01AB")
    past_7_day_sales: int = Field(..., ge=0, example=30)
    past_30_day_avg_sales: float = Field(..., ge=0, example=4.25)
    current_stock: int = Field(..., ge=0, example=146)
    days_to_expiry: int = Field(..., ge=0, example=317)
    price_per_unit: int = Field(..., gt=0, example=150)

    # these are the optional inputs which will be auto filled by the scraper if not provided
    live_temp: Optional[float] = Field(default=None, example=25.7)
    live_humidity: Optional[float] = Field(default=None, example=47.5)
    is_rainy: Optional[int] = Field(default=None, ge=0, le=1, example=0)
    fever_trend: Optional[int] = Field(default=None, ge=0, le=100, example=28)
    allergy_trend: Optional[int] = Field(default=None, ge=0, le=100, example=31)
    # Note: cold_trend & dengue_trend were removed — not present in training data


class response_model(BaseModel):
    medicine_name: str
    next_7_day_demand: int = Field(..., ge=0, description="Predicted demand for next 7 days")
    days_to_reorder: int = Field(..., ge=0, description="Stock will last for X days")
    reorder_quantity: int = Field(..., ge=0, description="How much to order")
    expiry_risk: str = Field(..., example="Low")
    live_data_used: dict


def get_live_data():
    try:
        live_df = pd.read_csv(LIVE_DATA_PATH)
        row = live_df.iloc[-1].to_dict()
        return row
    except Exception:
        # fallback if file missing
        return {
            'live_temp': 26.5, 'live_humidity': 70.0, 'is_rainy': 0,
            'fever_trend': 30, 'allergy_trend': 25
        }


@app.post("/predict", response_model=response_model)
def predict(req: predict_request):
    # 1. Get live data if not provided
    live = get_live_data()

    live_temp     = req.live_temp     if req.live_temp     is not None else live['live_temp']
    live_humidity = req.live_humidity if req.live_humidity is not None else live['live_humidity']
    is_rainy      = req.is_rainy      if req.is_rainy      is not None else live['is_rainy']
    fever_trend   = req.fever_trend   if req.fever_trend   is not None else live['fever_trend']
    allergy_trend = req.allergy_trend if req.allergy_trend is not None else live['allergy_trend']

    # 2. Current month - from system
    current_month = datetime.now().month

    # 3. Feature order MUST match retrained model exactly (11 features)
    # Verified order from retrain.py output:
    # [0] past_7_day_sales
    # [1] past_30_day_avg_sales
    # [2] current_stock
    # [3] days_to_expiry
    # [4] price_per_unit
    # [5] live_temp
    # [6] live_humidity
    # [7] is_rainy
    # [8] fever_trend
    # [9] allergy_trend
    # [10] month
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

    # 4. Predict
    try:
        pred_demand = int(model.predict(features)[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model prediction failed: {e}")

    # 5. Business logic
    daily_avg = req.past_30_day_avg_sales if req.past_30_day_avg_sales > 0 else 1
    next_7_day_demand = pred_demand

    # How many days current stock will last
    days_to_reorder = int(req.current_stock / daily_avg)

    # How much to reorder (cover 30 days of predicted demand, minus current stock)
    monthly_demand = int((pred_demand / 7) * 30)
    reorder_quantity = max(0, monthly_demand - req.current_stock)

    # Expiry risk
    if req.days_to_expiry < 30:
        expiry_risk = "High"
    elif req.days_to_expiry < 90:
        expiry_risk = "Medium"
    else:
        expiry_risk = "Low"

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

@app.get("/health")
def health():
    return {"status": "ok"}


app.mount("/", StaticFiles(directory=BASE_DIR / "frontend", html=True), name="frontend")