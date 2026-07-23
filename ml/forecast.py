"""Phase 3 - Monthly crime forecasting (offline).

Reads the Phase-0 base (etl/out/agg_district_month.csv) + dim_district, builds a
bounded set of monthly series and forecasts the next 12 months with confidence
intervals. Engine: Holt-Winters exponential smoothing (statsmodels), additive trend
+ additive seasonality (period 12), with a seasonal-naive fallback for short/sparse
series. Prophet was skipped for Windows install reliability under time pressure; the
task explicitly sanctions the statsmodels/seasonal-naive fallback.

TRAINING WINDOW: 2016-2023 only. 2024 is a PARTIAL year in the source and is excluded
from both training and the displayed history so the projection isn't distorted.

Series set (bounded, tractable):
  - state total                              (1)
  - per parent-district total                (31)
  - statewide per major-category (top 12)    (12)
  - per district x that district's top-5     (<=155)

Output -> ml/out/forecasts.csv
  columns: level, key, category, year, month, y_actual, yhat, yhat_lower, yhat_upper,
           is_forecast, method
  history rows: is_forecast=0, y_actual filled, yhat/CI blank
  forecast rows: is_forecast=1, yhat + CI filled, y_actual blank

Predictions are derived from real data -> data_class=real; the UI must present them as
projections (dashed line + CI band). Re-runnable.  Run:  python ml/forecast.py
"""
from __future__ import annotations

import os
import time
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")  # statsmodels convergence/estimation chatter
np.seterr(all="ignore")

from statsmodels.tsa.holtwinters import ExponentialSmoothing  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

SEASON = 12
HORIZON = 12
MIN_ETS_MONTHS = 30          # need >= ~2.5 seasons for a stable seasonal ETS fit
MIN_SERIES_TOTAL = 60        # skip tiny/noisy series
TRAIN_END_T = 2023 * 12 + 11  # December 2023 (exclude partial 2024)
FORECAST_START_T = 2024 * 12  # January 2024
TOP_CATEGORIES = 12
TOP_CATS_PER_DISTRICT = 5


def t_to_ym(t):
    return int(t // 12), int(t % 12 + 1)


def build_continuous(df_ym):
    """Continuous monthly series through Dec-2023, zero-filled, leading zeros trimmed."""
    g = df_ym.groupby(["year", "month"], as_index=False)["count"].sum()
    g["t"] = g["year"] * 12 + (g["month"] - 1)
    g = g[g["t"] <= TRAIN_END_T]
    if g.empty:
        return None
    tmin = int(g["t"].min())
    idx = pd.DataFrame({"t": range(tmin, TRAIN_END_T + 1)})
    m = idx.merge(g[["t", "count"]], on="t", how="left").fillna({"count": 0.0})
    nz = np.flatnonzero(m["count"].to_numpy())
    if len(nz) == 0:
        return None
    m = m.iloc[nz[0]:].reset_index(drop=True)
    ym = m["t"].apply(t_to_ym)
    m["year"] = [a for a, _ in ym]
    m["month"] = [b for _, b in ym]
    return m


def seasonal_naive(y, horizon=HORIZON, season=SEASON):
    y = np.asarray(y, float)
    if len(y) >= season:
        last = y[-season:]
        fc = np.array([last[h % season] for h in range(horizon)])
        sigma = np.nanstd(y[season:] - y[:-season]) if len(y) > season else np.nanstd(y)
    else:
        mean = float(np.mean(y)) if len(y) else 0.0
        fc = np.full(horizon, mean)
        sigma = float(np.nanstd(y)) if len(y) else 0.0
    return fc, (sigma if np.isfinite(sigma) else 0.0)


def fit_full(y, horizon=HORIZON):
    method = "snaive"
    fc = sigma = None
    if len(y) >= MIN_ETS_MONTHS and np.count_nonzero(y) >= SEASON:
        try:
            fit = ExponentialSmoothing(
                y, trend="add", seasonal="add", seasonal_periods=SEASON,
                initialization_method="estimated",
            ).fit()
            fc = np.asarray(fit.forecast(horizon), float)
            resid = y - np.asarray(fit.fittedvalues, float)
            sigma = float(np.nanstd(resid))
            if not np.all(np.isfinite(fc)):
                raise ValueError("non-finite forecast")
            method = "ets"
        except Exception:
            fc = sigma = None
    if fc is None:
        fc, sigma = seasonal_naive(y, horizon)
    steps = np.arange(1, horizon + 1)
    band = 1.96 * (sigma or 0.0) * np.sqrt(steps)
    lower = np.clip(fc - band, 0, None)
    upper = np.clip(fc + band, 0, None)
    fc = np.clip(fc, 0, None)
    return fc, lower, upper, method


def backtest(y, horizon=HORIZON, season=SEASON):
    """Hold out the last 12 months (2023); train on the rest; return (MAPE%, RMSE)."""
    if len(y) < season + horizon + 6:
        return None, None
    train, test = y[:-horizon], y[-horizon:]
    fc = None
    if len(train) >= MIN_ETS_MONTHS and np.count_nonzero(train) >= season:
        try:
            fit = ExponentialSmoothing(
                train, trend="add", seasonal="add", seasonal_periods=season,
                initialization_method="estimated",
            ).fit()
            fc = np.asarray(fit.forecast(horizon), float)
            if not np.all(np.isfinite(fc)):
                fc = None
        except Exception:
            fc = None
    if fc is None:
        fc, _ = seasonal_naive(train, horizon, season)
    fc = np.clip(fc, 0, None)
    mask = test > 0
    mape = float(np.mean(np.abs(test[mask] - fc[mask]) / test[mask]) * 100) if mask.any() else None
    rmse = float(np.sqrt(np.mean((test - fc) ** 2)))
    return mape, rmse


def main():
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)

    dm = pd.read_csv(os.path.join(IN_DIR, "agg_district_month.csv"))
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"), dtype=str)
    geo = dim[dim["is_geographic"].astype(str).str.lower() == "true"].copy()
    parent_of = dict(zip(geo["canonical_name"], geo["parent_district"].fillna(geo["canonical_name"])))

    dm = dm[dm["canonical_name"].isin(parent_of)].copy()
    dm["district"] = dm["canonical_name"].map(parent_of)
    districts = sorted(dm["district"].dropna().unique().tolist())

    cat_totals = dm.groupby("major_head")["count"].sum().sort_values(ascending=False)
    top_cats = cat_totals.head(TOP_CATEGORIES).index.tolist()

    records = []
    mapes, rmses, methods = [], [], {"ets": 0, "snaive": 0}
    state_mape = None

    def process(level, key, category, df_ym):
        nonlocal state_mape
        ser = build_continuous(df_ym)
        if ser is None or ser["count"].sum() < MIN_SERIES_TOTAL:
            return
        y = ser["count"].to_numpy(float)
        mape, rmse = backtest(y)
        if mape is not None:
            mapes.append(mape)
            rmses.append(rmse)
            if level == "state":
                state_mape = mape
        fc, lower, upper, method = fit_full(y)
        methods[method] = methods.get(method, 0) + 1
        for _, r in ser.iterrows():
            records.append([level, key, category, int(r["year"]), int(r["month"]),
                            round(float(r["count"]), 1), "", "", "", 0, ""])
        for h in range(HORIZON):
            yr, mo = t_to_ym(FORECAST_START_T + h)
            records.append([level, key, category, yr, mo, "",
                            round(float(fc[h]), 1), round(float(lower[h]), 1),
                            round(float(upper[h]), 1), 1, method])

    # 1) statewide total
    process("state", "Karnataka", "ALL", dm)
    # 2) per parent-district total
    for d in districts:
        process("district", d, "ALL", dm[dm["district"] == d])
    # 3) statewide per major-category (top 12)
    for c in top_cats:
        process("category", "Karnataka", c, dm[dm["major_head"] == c])
    # 4) per district x that district's top-5 categories
    for d in districts:
        sub = dm[dm["district"] == d]
        d_top = sub.groupby("major_head")["count"].sum().nlargest(TOP_CATS_PER_DISTRICT).index
        for c in d_top:
            process("district_category", d, c, sub[sub["major_head"] == c])

    out = pd.DataFrame(records, columns=[
        "level", "key", "category", "year", "month", "y_actual",
        "yhat", "yhat_lower", "yhat_upper", "is_forecast", "method"])
    out.to_csv(os.path.join(OUT_DIR, "forecasts.csv"), index=False)

    n_series = methods["ets"] + methods["snaive"]
    med_mape = float(np.median(mapes)) if mapes else float("nan")
    med_rmse = float(np.median(rmses)) if rmses else float("nan")
    print(f"[forecast] series={n_series} (ets={methods['ets']}, snaive={methods['snaive']}) "
          f"| forecast horizon={HORIZON}mo (2024)")
    print(f"[forecast] BACKTEST on held-out 2023: statewide MAPE={state_mape:.1f}% | "
          f"median MAPE={med_mape:.1f}% | median RMSE={med_rmse:.0f}  (n={len(mapes)} series)")
    print(f"[forecast] wrote forecasts.csv ({len(out):,} rows)  [{time.time()-t0:.0f}s]")


if __name__ == "__main__":
    main()
