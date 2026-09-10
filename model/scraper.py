import requests, os, json, time, csv
from datetime import datetime
from dotenv import load_dotenv
import pandas as pd

load_dotenv()

DATA_FILE = "live_data.csv"
JSON_FILE = "live_scraped_cache.json"

def get_live_weather(city="Kalyan"):
    API_KEY = os.getenv("API_KEY") or os.getenv("WEATHER_API_KEY")
    url = f"https://api.openweathermap.org/data/2.5/weather?q={city}&appid={API_KEY}&units=metric"
    try:
        res = requests.get(url, timeout=10).json()
        if res.get("cod")!= 200:
            print(f"Weather API Error: {res}")
            return None
        return {
            "live_temp": res['main']['temp'],
            "live_humidity": res['main']['humidity'],
            "weather_main": res['weather'][0]['main'],
            "is_rainy": 1 if res['weather'][0]['main'] == 'Rain' else 0
        }
    except Exception as e:
        print(f"Weather failed: {e}")
        return None

def get_disease_trend():
    # Try pytrends with retry logic
    try:
        from pytrends.request import TrendReq
        pytrends = TrendReq(hl='en-US', tz=330, timeout=(10,25))
        kw_list = ["fever", "cold cough", "dengue symptoms", "cetirizine"]
        # Add sleep to avoid 429
        time.sleep(2)
        pytrends.build_payload(kw_list, timeframe='now 7-d', geo='IN-MH')
        time.sleep(2)
        df = pytrends.interest_over_time()

        if not df.empty:
            print("pytrends SUCCESS - real data fetched")
            return {
                "fever_trend": int(df["fever"].iloc[-1]),
                "cold_trend": int(df["cold cough"].iloc[-1]),
                "dengue_trend": int(df["dengue symptoms"].iloc[-1]),
                "allergy_trend": int(df["cetirizine"].iloc[-1]),
                "source": "pytrends_real"
            }
    except Exception as e:
        print(f"pytrends failed (429 expected): {e}")

    # FALLBACK: Use last cached real data if available
    if os.path.exists(JSON_FILE):
        with open(JSON_FILE, 'r') as f:
            cached = json.load(f)
            print("Using cached trend data")
            return cached.get("disease_trends")

    # Final fallback
    return {
        "fever_trend": 55, "cold_trend": 48,
        "dengue_trend": 25, "allergy_trend": 60,
        "source": "fallback"
    }

def get_festival_flag():
    # Simple logic without API for now - real enough
    # You can add calendarific later
    return {"is_festival_tomorrow": 0, "festival_name": "None"}

def scrape_and_save():
    print("--- Scraping Live Data ---")
    weather = get_live_weather()
    disease = get_disease_trend()
    festival = get_festival_flag()

    if not weather:
        print("Weather failed, aborting save")
        return

    final_row = {
        "timestamp": datetime.now().isoformat(),
        "date": datetime.now().strftime("%Y-%m-%d"),
        "live_temp": weather["live_temp"],
        "live_humidity": weather["live_humidity"],
        "is_rainy": weather["is_rainy"],
        "fever_trend": disease["fever_trend"],
        "cold_trend": disease["cold_trend"],
        "dengue_trend": disease["dengue_trend"],
        "allergy_trend": disease["allergy_trend"],
        "is_festival_tomorrow": festival["is_festival_tomorrow"],
        "data_source": disease.get("source", "unknown")
    }

    # 1. Save to JSON cache (for fallback)
    with open(JSON_FILE, 'w') as f:
        json.dump({"weather": weather, "disease_trends": disease, "last_updated": final_row["timestamp"]}, f, indent=2)

    # 2. Append to CSV (your real dataset for model)
    df = pd.DataFrame([final_row])
    if not os.path.exists(DATA_FILE):
        df.to_csv(DATA_FILE, index=False)
    else:
        df.to_csv(DATA_FILE, mode='a', header=False, index=False)

    print(f"Saved: {final_row}")
    print(f"Files created: {DATA_FILE}, {JSON_FILE}")

if __name__ == "__main__":
    scrape_and_save()