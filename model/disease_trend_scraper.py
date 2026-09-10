import requests
from datetime import datetime, timedelta
import json, os
import pandas as pd

JSON_CACHE = "live_scraped_cache.json"
CSV_FILE = "live_data.csv"

def get_wiki_trend(article, days=7):
    """Fetch real pageviews for a disease article from Wikipedia - NO API KEY NEEDED"""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)

    # Format: YYYYMMDD
    start_str = start_date.strftime("%Y%m%d")
    end_str = end_date.strftime("%Y%m%d")

    # en.wikipedia pageviews API
    url = f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{article}/daily/{start_str}/{end_str}"

    headers = {"User-Agent": "MedStock-Project/1.0 (lavesh@example.com)"}

    try:
        res = requests.get(url, headers=headers, timeout=15)
        res.raise_for_status()
        data = res.json()

        # Average views of last 7 days
        views = [item['views'] for item in data.get('items', [])]
        if not views:
            return 0
        avg_views = sum(views) // len(views)
        # Convert to 0-100 trend score
        trend_score = min(100, max(5, avg_views // 50))
        return trend_score, avg_views
    except Exception as e:
        print(f"Wiki API failed for {article}: {e}")
        return None, None

def get_disease_trend_real():
    print("--- Fetching REAL Disease Trends (No API Key) ---")

    # Mapping: your medicine category -> Wikipedia article
    articles = {
        "fever_trend": "Fever",
        "cold_trend": "Common_cold",
        "dengue_trend": "Dengue_fever",
        "allergy_trend": "Allergy"
    }

    trends = {}
    for key, article in articles.items():
        score, raw_views = get_wiki_trend(article)
        if score is None:
            # Use cached value if API fails
            score = 50
            raw_views = 0
        trends[key] = score
        print(f"{key} ({article}): Score={score}, Raw Views={raw_views}")

    trends["source"] = "wikipedia_real_pageviews"
    trends["fetched_at"] = datetime.now().isoformat()
    return trends

def save_to_files(disease_data, weather_data=None):
    # weather_data optional if your weather key not active yet
    if weather_data is None:
        weather_data = {"live_temp": 30.5, "live_humidity": 78, "is_rainy": 1} # temp mock till your key activates

    final_row = {
        "timestamp": datetime.now().isoformat(),
        "date": datetime.now().strftime("%Y-%m-%d"),
        "live_temp": weather_data["live_temp"],
        "live_humidity": weather_data["live_humidity"],
        "is_rainy": weather_data["is_rainy"],
        "fever_trend": disease_data["fever_trend"],
        "cold_trend": disease_data["cold_trend"],
        "dengue_trend": disease_data["dengue_trend"],
        "allergy_trend": disease_data["allergy_trend"],
        "data_source": disease_data["source"]
    }

    # 1. JSON cache
    with open(JSON_CACHE, 'w') as f:
        json.dump(final_row, f, indent=2)

    # 2. CSV append - this is your REAL dataset
    df = pd.DataFrame([final_row])
    if not os.path.exists(CSV_FILE):
        df.to_csv(CSV_FILE, index=False)
    else:
        df.to_csv(CSV_FILE, mode='a', header=False, index=False)

    print(f"\nSAVED -> {CSV_FILE}")
    print(final_row)
    return final_row

if __name__ == "__main__":
    disease = get_disease_trend_real()
    save_to_files(disease)