import os
import hashlib
import binascii
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, Float, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

# Ensure .env is loaded
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://username:password@localhost/dbname"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# Password security utilities
def hash_password(password: str) -> str:
    salt = hashlib.sha256(os.urandom(60)).hexdigest().encode('ascii')
    pwdhash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    pwdhash = binascii.hexlify(pwdhash)
    return (salt + pwdhash).decode('ascii')


def verify_password(stored_password: str, provided_password: str) -> bool:
    try:
        salt = stored_password[:64].encode('ascii')
        stored_hash = stored_password[64:]
        pwdhash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt, 100000)
        pwdhash = binascii.hexlify(pwdhash).decode('ascii')
        return pwdhash == stored_hash
    except Exception:
        return False


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(20), nullable=False, default="staff")  # "owner" or "staff"
    full_name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "full_name": self.full_name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    medicine_name = Column(String(100), nullable=False, index=True)
    atc_code = Column(String(20), nullable=False)
    past_7_day_sales = Column(Integer, nullable=False)
    past_30_day_avg_sales = Column(Float, nullable=False)
    current_stock = Column(Integer, nullable=False)
    days_to_expiry = Column(Integer, nullable=False)
    price_per_unit = Column(Float, nullable=False)

    live_temp = Column(Float, nullable=True)
    live_humidity = Column(Float, nullable=True)
    is_rainy = Column(Integer, nullable=True)
    fever_trend = Column(Integer, nullable=True)
    allergy_trend = Column(Integer, nullable=True)

    next_7_day_demand = Column(Integer, nullable=False)
    days_to_reorder = Column(Integer, nullable=False)
    reorder_quantity = Column(Integer, nullable=False)
    expiry_risk = Column(String(20), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "medicine_name": self.medicine_name,
            "atc_code": self.atc_code,
            "past_7_day_sales": self.past_7_day_sales,
            "past_30_day_avg_sales": self.past_30_day_avg_sales,
            "current_stock": self.current_stock,
            "days_to_expiry": self.days_to_expiry,
            "price_per_unit": self.price_per_unit,
            "live_data_used": {
                "live_temp": self.live_temp,
                "live_humidity": self.live_humidity,
                "is_rainy": self.is_rainy,
                "fever_trend": self.fever_trend,
                "allergy_trend": self.allergy_trend,
            },
            "next_7_day_demand": self.next_7_day_demand,
            "days_to_reorder": self.days_to_reorder,
            "reorder_quantity": self.reorder_quantity,
            "expiry_risk": self.expiry_risk,
        }


class StockRequest(Base):
    __tablename__ = "stock_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    medicine_name = Column(String(100), nullable=False)
    requested_quantity = Column(Integer, nullable=False)
    urgency = Column(String(20), default="Medium")  
    notes = Column(Text, nullable=True)
    status = Column(String(20), default="PENDING")  

    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    requested_by_name = Column(String(100), nullable=False, default="Staff Member")

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "medicine_name": self.medicine_name,
            "requested_quantity": self.requested_quantity,
            "urgency": self.urgency,
            "notes": self.notes,
            "status": self.status,
            "requested_by_id": self.requested_by_id,
            "requested_by_name": self.requested_by_name,
        }


def init_db():
    Base.metadata.create_all(bind=engine)
    seed_users()
    seed_initial_dataset_inventory()


def seed_users():
    db = SessionLocal()
    try:
        owner = db.query(User).filter_by(username="owner").first()
        if not owner:
            db.add(User(
                username="owner",
                password_hash=hash_password("OwnerSecure2026!"),
                role="owner",
                full_name="Pharmacy Owner (Admin)"
            ))
        staff = db.query(User).filter_by(username="staff").first()
        if not staff:
            db.add(User(
                username="staff",
                password_hash=hash_password("StaffSecure2026!"),
                role="staff",
                full_name="Pharmacy Staff Member"
            ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"User seeding note: {e}")
    finally:
        db.close()


def seed_initial_dataset_inventory():
    db = SessionLocal()
    try:
        csv_path = BASE_DIR / "model" / "FINAL_TRAINING_DATA_25000.csv"
        if csv_path.exists():
            import pandas as pd
            df = pd.read_csv(csv_path)
            existing_meds = set(m[0] for m in db.query(Prediction.medicine_name).distinct().all())

            # Pick latest row per unique medicine
            unique_meds = df.groupby('medicine_name').last().reset_index()

            added_count = 0
            for _, row in unique_meds.iterrows():
                med_name = str(row['medicine_name'])
                if med_name not in existing_meds:
                    days_exp = int(row.get('days_to_expiry', 180))
                    risk = "High" if days_exp < 30 else "Medium" if days_exp < 90 else "Low"
                    past_30_avg = float(row.get('past_30_day_avg_sales', 5.0))
                    curr_stock = int(row.get('current_stock', 100))
                    daily_avg = past_30_avg if past_30_avg > 0 else 1.0
                    days_reorder = int(curr_stock / daily_avg)
                    next_7_demand = int(row.get('next_7_day_demand', 40))
                    reorder_qty = max(0, int((next_7_demand / 7) * 30) - curr_stock)

                    db.add(Prediction(
                        medicine_name=med_name,
                        atc_code=str(row.get('atc_code', 'M01')),
                        past_7_day_sales=int(row.get('past_7_day_sales', 30)),
                        past_30_day_avg_sales=past_30_avg,
                        current_stock=curr_stock,
                        days_to_expiry=days_exp,
                        price_per_unit=float(row.get('price_per_unit', 100)),
                        live_temp=float(row.get('live_temp', 25.0)),
                        live_humidity=float(row.get('live_humidity', 50.0)),
                        is_rainy=int(row.get('is_rainy', 0)),
                        fever_trend=int(row.get('fever_trend', 30)),
                        allergy_trend=int(row.get('allergy_trend', 25)),
                        next_7_day_demand=next_7_demand,
                        days_to_reorder=days_reorder,
                        reorder_quantity=reorder_qty,
                        expiry_risk=risk
                    ))
                    added_count += 1

            if added_count > 0:
                db.commit()
                print(f"Successfully seeded {added_count} missing dataset medicines into Neon PostgreSQL!")
    except Exception as e:
        db.rollback()
        print(f"Dataset seeding note: {e}")
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
