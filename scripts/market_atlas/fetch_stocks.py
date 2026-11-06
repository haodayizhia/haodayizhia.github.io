# -*- coding: utf-8 -*-
"""
股票历史行情与全指标同步器 (全量 / 截面增量混合引擎 · 零误差版)
================================================================================
核心特性：
1. 模式可控 (SYNC_MODE)：
   - "auto"        : 默认推荐。自动扫描本地 CSV，已最新则秒跳过；仅缺尾部交易日时按日期横截面
                     一次性拉取全市场数据；遇到除权除息、新股、历史头部缺失时自动回退单股全量重拉。
   - "incremental" : 优先执行截面增量同步（仅在无本地文件、缺历史头部或发生除权时回退单股全量）。
   - "full"        : 强制逐股调用 ts.pro_bar + pro.daily_basic 全量重新下载并覆盖全部 CSV。
2. 零误差前复权与除权自愈：
   - 增量模式下自动比对本地末尾交易日与最新交易日的复权因子 (adj_factor)。
   - 未发生除权的股票，新增交易日的前复权价严格等于 daily 原始价，避免浮点折算误差。
   - 发生除权除息（adj_factor 变动）的股票，自动回退调用 ts.pro_bar 全量重刷历史价格。
3. 预热期指标一致性保护：
   - 增量更新时绝不篡改本地已落盘的历史行，仅拼接新增行计算指标。
   - OBV 严格锚定本地 CSV 最后一行的累积值往后递推，确保与全量预热计算结果 100% 一致。
4. 原子落盘：
   - 采用 .tmp 临时文件 + os.replace 原子替换，任何网络中断或异常均不损坏已有 CSV。
================================================================================
"""

import os
import re
import sys
import time
import glob
import random
import warnings
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import tushare as ts
from functools import partial
import requests

# parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# if parent_dir not in sys.path:
#     sys.path.append(parent_dir)
# import ts_init

warnings.filterwarnings("ignore")
base_dir = os.path.dirname(os.path.abspath(__file__))


# ── Section 1 · 核心参数配置区 ───────────────────────────────────────────────

TS_TOKEN = os.environ["TUSHARE_TOKEN"]

class HTTPSDataApi:
    """Official REST payload over TLS; also passed explicitly to ts.pro_bar."""
    def query(self, api_name, fields='', **params):
        response = requests.post('https://api.tushare.pro', json={
            'api_name': api_name, 'token': TS_TOKEN, 'params': params, 'fields': fields,
        }, timeout=45)
        response.raise_for_status()
        result = response.json()
        if result.get('code') != 0:
            raise RuntimeError(result.get('msg') or 'Tushare request failed')
        data = result.get('data') or {}
        return pd.DataFrame(data.get('items', []), columns=data.get('fields', []))

    def __getattr__(self, name):
        return partial(self.query, name)


pro = HTTPSDataApi()

# 日期与同步模式配置
DATA_START_DATE = "20240101"   # 导出 CSV 的起始日期 (YYYYMMDD)
TARGET_DATE     = "auto"       # 导出 CSV 的截止日期 ("auto" 自动探测最新交易日，或指定 "YYYYMMDD")
SYNC_MODE       = "auto"       # 同步模式: "auto" (智能增量/全量) | "incremental" (截面增量) | "full" (强制全量)
STOCK_CODE_PREFIXES = ("00", "60")  # 仅处理以这些数字开头的股票代码；设为 () 则不过滤

# 增量与预热参数
INCREMENTAL_MAX_DAYS = 60      # 缺失交易日不超过该阈值时启用按日截面拉取，超出则转全量
MIN_WARMUP_ROWS      = 250     # 非次新股增量重算所需的最小本地历史行数（保证 120日低点与 EMA 完全收敛）
WARMUP_CALENDAR_DAYS = 365     # 全量模式下在 DATA_START_DATE 之前额外拉取的自然日预热跨度

# 接口限频休眠区间（秒）
SLEEP_MIN = 0.3
SLEEP_MAX = 0.7

# 路径配置
OUTPUT_DIR = os.environ.get("MARKET_ATLAS_RAW_DIR", os.path.join(base_dir, "stock_data"))
STOCK_DIR  = os.path.join(OUTPUT_DIR, "")
POOL_FILE  = os.environ.get("MARKET_ATLAS_POOL_FILE", os.path.join(base_dir, "cloud-pool.csv"))

os.makedirs(STOCK_DIR, exist_ok=True)

# 导出列名映射与固定列序
RENAME_MAP = {
    "con_code": "代码",
    "name": "名称",
    "industry_name": "所属行业",
    "trade_date": "交易日期",
    "open": "开盘价",
    "high": "最高价",
    "low": "最低价",
    "close": "现价",
    "pre_close": "昨收价",
    "change": "涨跌额",
    "pct_chg": "涨幅%",
    "tor_val": "换手率",
    "turnover_rate_f": "自由流通换手率%",
    "volume_ratio": "官方量比",
    "vol_wan": "成交量(万股)",
    "amount_yi": "成交额(亿元)",
    "vol_ratio_5d": "5日量比",
    "bottom_gains": "距120日低点涨幅%",
    "ma5": "MA5",
    "ma10": "MA10",
    "ma20": "MA20",
    "ma60": "MA60",
    "macd_dif": "MACD_DIF",
    "macd_dea": "MACD_DEA",
    "macd_hist": "MACD柱",
    "macd_gc": "MACD金叉",
    "kdj_k": "KDJ_K",
    "kdj_d": "KDJ_D",
    "kdj_j": "KDJ_J",
    "kdj_gc": "KDJ金叉",
    "rsi_6": "RSI6",
    "rsi_12": "RSI12",
    "rsi_gc": "RSI金叉",
    "obv": "OBV",
    "obv_gc": "OBV金叉",
}

ORDERED_COLS = [
    "代码", "名称", "现价", "涨幅%", "换手率", "自由流通换手率%",
    "成交量(万股)", "成交额(亿元)", "5日量比", "官方量比", "距120日低点涨幅%",
    "交易日期", "开盘价", "最高价", "最低价", "昨收价", "涨跌额",
    "MA5", "MA10", "MA20", "MA60",
    "MACD_DIF", "MACD_DEA", "MACD柱", "MACD金叉",
    "KDJ_K", "KDJ_D", "KDJ_J", "KDJ金叉",
    "RSI6", "RSI12", "RSI金叉",
    "OBV", "OBV金叉",
    "所属行业",
]


# ── Section 2 · 交易日历探针、代码格式化与行业字典 ───────────────────────────

# 全量拉取预热起始日（提前 365 天，满足 120 交易日滚动窗口并消除 EMA 初始偏差）
FETCH_START_DATE = (
    datetime.strptime(DATA_START_DATE, "%Y%m%d") - timedelta(days=WARMUP_CALENDAR_DAYS)
).strftime("%Y%m%d")


def _probe_trade_calendar(target: str, fetch_start: str) -> tuple[str, list[str], str]:
    """
    通过 000001.SZ 探针一次性获取：
    1) 截止目标日之前的真实最新交易日 REAL_END_DATE（防止非交易日或收盘前空数据覆盖）
    2) [fetch_start, REAL_END_DATE] 区间内完整的真实交易日序列 TRADE_CALENDAR
    """
    probe_dt = datetime.now() if target == "auto" else datetime.strptime(target, "%Y%m%d")
    target_end = probe_dt.strftime("%Y%m%d")
    calendar_start = min(fetch_start, (probe_dt - timedelta(days=30)).strftime("%Y%m%d"))

    try:
        df_probe = ts.pro_bar(
            api=pro,
            ts_code="000001.SZ",
            start_date=calendar_start,
            end_date=target_end,
            retry_count=3,
        )
        if df_probe is None or df_probe.empty or "trade_date" not in df_probe.columns:
            raise RuntimeError("探针未返回有效交易日期")

        valid_dates = df_probe["trade_date"].astype(str)
        valid_dates = valid_dates[valid_dates.str.fullmatch(r"\d{8}") & valid_dates.le(target_end)]
        if valid_dates.empty:
            raise RuntimeError("探针没有可用交易日")

        calendar_list = sorted(valid_dates.unique().tolist())
        latest = calendar_list[-1]
        msg = (
            f"探针成功: 最新截面为 [{latest}]"
            if target == "auto"
            else f"探针成功: 目标日 [{target}] -> 真实交易日为 [{latest}]"
        )
        return latest, calendar_list, msg
    except Exception as exc:
        raise RuntimeError(
            f"交易日探针失败，已中止，避免错误日期覆盖历史数据：{exc}"
        ) from exc


REAL_LATEST_DATE, TRADE_CALENDAR, _probe_msg = _probe_trade_calendar(TARGET_DATE, FETCH_START_DATE)
REAL_END_DATE = REAL_LATEST_DATE

# 计算 >= DATA_START_DATE 的首个真实交易日（如 20240101 元旦休市，则首日为 20240102）
_valid_start_dates = [d for d in TRADE_CALENDAR if d >= DATA_START_DATE]
FIRST_DATA_TRADE_DATE = _valid_start_dates[0] if _valid_start_dates else DATA_START_DATE

print(f"[*] {_probe_msg}")
print(f"[*] 数据统计区间为 [{DATA_START_DATE}] (首个交易日 {FIRST_DATA_TRADE_DATE}) 至 [{REAL_END_DATE}] | 同步模式: [{SYNC_MODE}]")


def format_ts_code(raw_code: str) -> str:
    """将各种写法的股票代码（如 '000001'、'000001.SZ'）统一规范化为 'XXXXXX.SH/SZ/BJ'。"""
    cleaned = str(raw_code).strip().upper()
    match = re.fullmatch(r"(\d{6})(?:\.(SH|SZ|BJ))?", cleaned)
    if not match:
        raise ValueError(f"无效股票代码: {raw_code!r}")
    num, market = match.groups()
    if market:
        return f"{num}.{market}"
    if num.startswith("6"):
        return f"{num}.SH"
    if num.startswith(("0", "3")):
        return f"{num}.SZ"
    return f"{num}.BJ"


def load_local_industry_map() -> dict:
    """加载本地同花顺行业分类快照文件，选取不超过 REAL_END_DATE 的最新一份。"""
    industry_map = {}
    files = [os.environ["MARKET_ATLAS_INDUSTRY_FILE"]] if os.environ.get("MARKET_ATLAS_INDUSTRY_FILE") else glob.glob(os.path.join(base_dir, "../all_stocks_with_ths_index_*"))
    stock_file = None
    if files:
        valid_files = []
        for f in files:
            m = re.search(r"(\d{8})", os.path.basename(f))
            if m:
                valid_files.append((f, m.group(1)))
        if valid_files:
            valid_files.sort(key=lambda x: x[1], reverse=True)
            chosen = next((f for f, d in valid_files if d <= REAL_END_DATE), None)
            stock_file = chosen or valid_files[0][0]
        else:
            stock_file = files[0]

    if stock_file and os.path.exists(stock_file):
        try:
            ths_df = pd.read_csv(stock_file, dtype={"ts_code": str})
            col_code = "ts_code" if "ts_code" in ths_df.columns else ths_df.columns[0]
            if "ths_industries" in ths_df.columns:
                for _, r in ths_df.iterrows():
                    raw_c = str(r[col_code])
                    num = "".join(filter(str.isdigit, raw_c))[:6]
                    if len(num) == 6:
                        formatted = format_ts_code(num)
                        industry_map[formatted] = r["ths_industries"]
        except Exception as exc:
            print(f"\n[!] 读取行业缓存失败：{exc}")
    return industry_map


LOCAL_INDUSTRY_MAP = load_local_industry_map()


def get_stock_industry(ts_code: str) -> str:
    """优先使用本地行业快照获取所属行业（取第一主行业）。"""
    if ts_code in LOCAL_INDUSTRY_MAP and pd.notna(LOCAL_INDUSTRY_MAP[ts_code]):
        return str(LOCAL_INDUSTRY_MAP[ts_code]).split(",")[0]
    return "未知"


# ── Section 3 · 通用技术指标计算引擎（全量与增量共用） ─────────────────────────

def _calc_moving_averages(df: pd.DataFrame) -> pd.DataFrame:
    """计算 5 / 10 / 20 / 60 日简单移动平均线（样本不足窗口长度时留空 NaN）。"""
    for d in (5, 10, 20, 60):
        df[f"ma{d}"] = df["close"].rolling(d, min_periods=d).mean()
    return df


def _calc_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    """计算 MACD 指标及金叉信号（DIF 上穿 DEA）。"""
    exp1 = df["close"].ewm(span=fast, adjust=False).mean()
    exp2 = df["close"].ewm(span=slow, adjust=False).mean()
    df["macd_dif"] = exp1 - exp2
    df["macd_dea"] = df["macd_dif"].ewm(span=signal, adjust=False).mean()
    df["macd_hist"] = 2 * (df["macd_dif"] - df["macd_dea"])
    df["macd_gc"] = (df["macd_dif"] > df["macd_dea"]) & (
        df["macd_dif"].shift(1) <= df["macd_dea"].shift(1)
    )
    return df


def _calc_kdj(df: pd.DataFrame, n: int = 9, m1: int = 3, m2: int = 3) -> pd.DataFrame:
    """计算 KDJ 指标及金叉信号（K 上穿 D；极值相等时 RSV 取中性值 50）。"""
    low_list = df["low"].rolling(n, min_periods=1).min()
    high_list = df["high"].rolling(n, min_periods=1).max()
    rsv = (df["close"] - low_list) / (high_list - low_list).replace(0, np.nan) * 100
    rsv = rsv.fillna(50.0)
    df["kdj_k"] = rsv.ewm(com=m1 - 1, adjust=False).mean()
    df["kdj_d"] = df["kdj_k"].ewm(com=m2 - 1, adjust=False).mean()
    df["kdj_j"] = 3 * df["kdj_k"] - 2 * df["kdj_d"]
    df["kdj_gc"] = (df["kdj_k"] > df["kdj_d"]) & (
        df["kdj_k"].shift(1) <= df["kdj_d"].shift(1)
    )
    return df


def _calc_rsi(df: pd.DataFrame, n1: int = 6, n2: int = 12) -> pd.DataFrame:
    """计算 RSI6 / RSI12 及金叉信号（价格连续走平无波动时取中性值 50）。"""
    delta = df["close"].diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    for n in (n1, n2):
        avg_up = up.ewm(com=n - 1, adjust=False).mean()
        avg_down = down.ewm(com=n - 1, adjust=False).mean()
        total = avg_up + avg_down
        rsi = 100 * avg_up / total.replace(0, np.nan)
        df[f"rsi_{n}"] = rsi.mask(total.eq(0), 50.0)
    df["rsi_gc"] = (df["rsi_6"] > df["rsi_12"]) & (
        df["rsi_6"].shift(1) <= df["rsi_12"].shift(1)
    )
    return df


def _calc_obv(
    df: pd.DataFrame,
    ma_period: int = 20,
    historical_obv: pd.Series | None = None,
) -> pd.DataFrame:
    """
    计算 OBV 能量潮及金叉信号（OBV 上穿 20 日均线）。
    - 全量模式：historical_obv 为 None，从首行起算 cumsum。
    - 增量模式：传入旧 CSV 已算好的 historical_obv 序列，新行直接以旧表最后一行的 OBV 为基准累加，
               确保与全量预热计算的 OBV 数值 100% 重合。
    """
    df["price_diff"] = df["close"].diff()
    df["obv_val"] = np.where(
        df["price_diff"] > 0,
        df["vol"],
        np.where(df["price_diff"] < 0, -df["vol"], 0.0),
    )

    if historical_obv is not None and len(historical_obv) > 0:
        n_old = len(historical_obv)
        old_obv_vals = pd.to_numeric(historical_obv, errors="coerce").to_numpy(dtype=float)
        last_old_obv = old_obv_vals[-1]
        new_obv_vals = last_old_obv + df["obv_val"].iloc[n_old:].cumsum().to_numpy(dtype=float)
        df["obv"] = np.concatenate([old_obv_vals, new_obv_vals])
    else:
        df["obv"] = df["obv_val"].cumsum()

    df["obv_ma"] = df["obv"].rolling(ma_period).mean()
    df["obv_gc"] = (df["obv"] > df["obv_ma"]) & (
        df["obv"].shift(1) <= df["obv_ma"].shift(1)
    )
    return df


def calculate_all_indicators(
    df: pd.DataFrame,
    historical_obv: pd.Series | None = None,
) -> pd.DataFrame:
    """在标准行情表上统一计算全部技术指标与衍生列，并保留 4 位小数。"""
    if df.empty:
        return df
    df = df.copy().sort_values("trade_date").reset_index(drop=True)

    numeric_inputs = [
        "open", "high", "low", "close", "pre_close", "vol", "amount",
        "change", "pct_chg", "turnover_rate", "turnover_rate_f", "volume_ratio",
    ]
    for col in numeric_inputs:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = _calc_moving_averages(df)
    df = _calc_macd(df)
    df = _calc_kdj(df)
    df = _calc_rsi(df)
    df = _calc_obv(df, ma_period=20, historical_obv=historical_obv)

    # 使用前复权价格计算涨跌额；涨幅% 优先保留 Tushare 官方除权口径
    df["change"] = df["close"] - df["pre_close"]
    if "pct_chg" not in df.columns:
        df["pct_chg"] = (df["close"] / df["pre_close"].replace(0, np.nan) - 1) * 100

    # 单位换算：vol(手 -> 万股 = /100)，amount(千元 -> 亿元 = /100000)
    df["vol_wan"] = df["vol"] / 100.0
    df["amount_yi"] = df["amount"] / 100000.0
    df["tor_val"] = df["turnover_rate"] if "turnover_rate" in df.columns else np.nan

    # 5日量比：当日成交量 / 过去5个交易日均量（不含当日）
    df["vol_ma5"] = df["vol"].shift(1).rolling(window=5, min_periods=5).mean()
    df["vol_ratio_5d"] = df["vol"] / df["vol_ma5"].replace(0, np.nan)

    # 距120日低点涨幅%：必须满 120 根 K 线才输出有效值
    df["rolling_low_120"] = df["low"].rolling(window=120, min_periods=120).min()
    df["bottom_gains"] = (df["close"] / df["rolling_low_120"].replace(0, np.nan) - 1) * 100

    # 金叉布尔值转中文标识
    for col in ("macd_gc", "kdj_gc", "rsi_gc", "obv_gc"):
        df[col] = np.where(df[col].fillna(False), "是", "否")

    # 数值列统一保留 4 位小数
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df[numeric_cols] = df[numeric_cols].round(4)
    return df


def _format_output_df(
    df_calc: pd.DataFrame,
    formatted_code: str,
    stock_name: str,
    industry_name: str,
) -> pd.DataFrame:
    """补充静态属性列、重命名为中文表头并严格校验列顺序。"""
    df_out = df_calc.copy()
    df_out["con_code"] = formatted_code
    df_out["name"] = stock_name
    df_out["industry_name"] = industry_name
    df_out = df_out.rename(columns=RENAME_MAP)

    missing_cols = set(ORDERED_COLS) - set(df_out.columns)
    if missing_cols:
        raise RuntimeError(f"待保存数据缺失列: {sorted(missing_cols)}")
    return df_out[ORDERED_COLS]


def append_incremental_indicators(
    df_old: pd.DataFrame,
    df_new_raw: pd.DataFrame,
    formatted_code: str,
    stock_name: str,
    industry_name: str,
) -> pd.DataFrame:
    """
    增量拼接计算：
    - 保持 df_old 已有的历史行完全不变（保护预热期算出的历史指标）。
    - 将 df_old 的基础行情与 df_new_raw 合并后计算新增行的全部指标，再追加到 df_old 末尾。
    """
    df_old = df_old.sort_values("交易日期").reset_index(drop=True)
    last_old_date = str(df_old["交易日期"].iloc[-1])

    # 只取严格晚于本地最后交易日的新增行情
    df_new_raw = df_new_raw[df_new_raw["trade_date"] > last_old_date].sort_values("trade_date").reset_index(drop=True)
    if df_new_raw.empty:
        return df_old

    # 从旧 CSV 还原基础输入列，用于为新增行提供滚动窗口与 EMA 递推上下文
    df_old_raw = pd.DataFrame({
        "trade_date": df_old["交易日期"].astype(str),
        "open": pd.to_numeric(df_old["开盘价"], errors="coerce"),
        "high": pd.to_numeric(df_old["最高价"], errors="coerce"),
        "low": pd.to_numeric(df_old["最低价"], errors="coerce"),
        "close": pd.to_numeric(df_old["现价"], errors="coerce"),
        "pre_close": pd.to_numeric(df_old["昨收价"], errors="coerce"),
        "change": pd.to_numeric(df_old["涨跌额"], errors="coerce"),
        "pct_chg": pd.to_numeric(df_old["涨幅%"], errors="coerce"),
        "vol": pd.to_numeric(df_old["成交量(万股)"], errors="coerce") * 100.0,
        "amount": pd.to_numeric(df_old["成交额(亿元)"], errors="coerce") * 100000.0,
        "turnover_rate": pd.to_numeric(df_old["换手率"], errors="coerce"),
        "turnover_rate_f": pd.to_numeric(df_old["自由流通换手率%"], errors="coerce"),
        "volume_ratio": pd.to_numeric(df_old["官方量比"], errors="coerce"),
    })

    raw_cols = list(df_old_raw.columns)
    df_combined_raw = pd.concat([df_old_raw, df_new_raw[raw_cols]], ignore_index=True)

    # 计算合并后的指标（OBV 锚定 df_old["OBV"]）
    df_combined_calc = calculate_all_indicators(df_combined_raw, historical_obv=df_old["OBV"])

    # 仅提取新增日期的计算结果并格式化为中文列
    df_new_calc = df_combined_calc[df_combined_calc["trade_date"] > last_old_date].reset_index(drop=True)
    df_new_formatted = _format_output_df(df_new_calc, formatted_code, stock_name, industry_name)

    # 同步更新旧表中的股票名称与所属行业（防止股票更名或行业快照更新后新旧行不一致）
    df_old_updated = df_old.copy()
    df_old_updated["代码"] = formatted_code
    df_old_updated["名称"] = stock_name
    df_old_updated["所属行业"] = industry_name

    df_merged = pd.concat([df_old_updated[ORDERED_COLS], df_new_formatted[ORDERED_COLS]], ignore_index=True)
    return df_merged


# ── Section 4 · 数据获取层（单股全量 vs 按日横截面批量拉取） ───────────────────

def _validate_kline_df(df_kline: pd.DataFrame, source_label: str = "K线") -> pd.DataFrame:
    """校验 K 线必要字段、日期格式、去重与数值合法性。"""
    if df_kline is None or df_kline.empty:
        raise RuntimeError(f"{source_label}接口返回空数据")
    required = {"trade_date", "open", "high", "low", "close", "pre_close", "vol", "amount"}
    missing = required - set(df_kline.columns)
    if missing:
        raise RuntimeError(f"{source_label}缺少必要字段: {sorted(missing)}")

    df_kline = df_kline.copy()
    df_kline["trade_date"] = df_kline["trade_date"].astype(str)
    if not df_kline["trade_date"].str.fullmatch(r"\d{8}").all():
        raise ValueError(f"{source_label}交易日期含无效值")
    if df_kline["trade_date"].duplicated().any():
        raise ValueError(f"{source_label}交易日期重复，拒绝覆盖旧CSV")
    for c in ("open", "high", "low", "close", "pre_close", "vol", "amount"):
        df_kline[c] = pd.to_numeric(df_kline[c], errors="coerce")
        if df_kline[c].isna().any():
            raise ValueError(f"{source_label}关键字段 {c} 出现缺失，拒绝覆盖旧CSV")
    if (df_kline["high"] < df_kline["low"]).any() or (df_kline["vol"] < 0).any():
        raise ValueError(f"{source_label}最高/最低价或成交量异常，拒绝覆盖旧CSV")
    return df_kline


def get_full_data(ts_code: str, max_retries: int = 3) -> pd.DataFrame:
    """
    单股全量拉取：调用 ts.pro_bar (前复权 qfq) + pro.daily_basic，
    获取 [FETCH_START_DATE, REAL_END_DATE] 完整历史数据。
    """
    time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))
    try:
        df_kline = ts.pro_bar(
            api=pro,
            ts_code=ts_code,
            adj="qfq",
            start_date=FETCH_START_DATE,
            end_date=REAL_END_DATE,
            retry_count=3,
        )
    except Exception as exc:
        raise RuntimeError(f"K线获取失败（pro_bar内部重试后）：{exc}") from exc

    df_kline = _validate_kline_df(df_kline, source_label="K线")

    df_basic = None
    last_basic_error = None
    for attempt in range(max_retries):
        try:
            time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))
            df_basic = pro.daily_basic(
                ts_code=ts_code,
                start_date=FETCH_START_DATE,
                end_date=REAL_END_DATE,
                fields="trade_date,turnover_rate,turnover_rate_f,volume_ratio",
            )
            if df_basic is None or df_basic.empty:
                raise RuntimeError("daily_basic 接口返回空数据")
            required_basic = {"trade_date", "turnover_rate", "turnover_rate_f", "volume_ratio"}
            missing = required_basic - set(df_basic.columns)
            if missing:
                raise RuntimeError(f"daily_basic 缺少字段: {sorted(missing)}")
            break
        except Exception as exc:
            last_basic_error = exc
            df_basic = None
            if attempt < max_retries - 1:
                time.sleep(1.5 * (attempt + 1))

    if df_basic is None:
        raise RuntimeError(f"daily_basic 获取失败（重试{max_retries}次）：{last_basic_error}")

    df_basic = df_basic.copy()
    df_basic["trade_date"] = df_basic["trade_date"].astype(str)
    if not df_basic["trade_date"].str.fullmatch(r"\d{8}").all():
        raise ValueError("daily_basic 交易日期存在无效值")
    if df_basic["trade_date"].duplicated().any():
        raise ValueError("daily_basic 交易日期重复，拒绝覆盖旧CSV")

    df_final = pd.merge(
        df_kline,
        df_basic[["trade_date", "turnover_rate", "turnover_rate_f", "volume_ratio"]],
        on="trade_date",
        how="left",
        validate="one_to_one",
    )
    return df_final.sort_values("trade_date").reset_index(drop=True)


def _call_pro_with_retry(api_func, max_retries: int = 3, **kwargs) -> pd.DataFrame:
    """通用带重试与限频休眠的 Tushare Pro 接口调用封装。"""
    last_err = None
    for attempt in range(max_retries):
        try:
            time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))
            df = api_func(**kwargs)
            if df is None or df.empty:
                raise RuntimeError(f"接口 {api_func.__name__}({kwargs}) 返回空数据")
            return df
        except Exception as exc:
            last_err = exc
            if attempt < max_retries - 1:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"接口 {api_func.__name__}({kwargs}) 调用失败: {last_err}")


def fetch_cross_section_by_dates(
    missing_dates: list[str],
    adj_check_dates: set[str],
    pool_codes: set[str],
    max_retries: int = 3,
) -> tuple[dict[str, pd.DataFrame], dict[tuple[str, str], float]]:
    """
    按交易日横截面批量拉取全市场数据：
    1) 对每个缺失交易日拉取全市场 pro.daily + pro.daily_basic，按股票代码归集。
    2) 对所有需要比对复权因子的日期（含本地最后交易日与最新交易日）拉取 pro.adj_factor，
       用于精确判断每只股票在增量期间是否发生除权除息。
    """
    daily_frames = []
    sorted_missing = sorted(set(missing_dates))
    total_days = len(sorted_missing)

    for idx, d in enumerate(sorted_missing, start=1):
        sys.stdout.write(f"\r[*] 正在拉取全市场截面行情: {idx}/{total_days} 日期 [{d}] ...")
        sys.stdout.flush()

        df_d = _call_pro_with_retry(pro.daily, max_retries=max_retries, trade_date=d)
        df_b = _call_pro_with_retry(
            pro.daily_basic,
            max_retries=max_retries,
            trade_date=d,
            fields="ts_code,trade_date,turnover_rate,turnover_rate_f,volume_ratio",
        )

        df_d = df_d[df_d["ts_code"].isin(pool_codes)].copy()
        df_b = df_b[df_b["ts_code"].isin(pool_codes)].copy()

        df_merged = pd.merge(
            df_d,
            df_b[["ts_code", "trade_date", "turnover_rate", "turnover_rate_f", "volume_ratio"]],
            on=["ts_code", "trade_date"],
            how="left",
        )
        daily_frames.append(df_merged)

    # 拉取复权因子截面：用于检测增量区间内是否有分红送转除权
    adj_map: dict[tuple[str, str], float] = {}
    sorted_adj_dates = sorted(set(adj_check_dates))
    for idx, d in enumerate(sorted_adj_dates, start=1):
        sys.stdout.write(f"\r[*] 正在校验全市场复权因子: {idx}/{len(sorted_adj_dates)} 日期 [{d}] ...")
        sys.stdout.flush()
        df_adj = _call_pro_with_retry(pro.adj_factor, max_retries=max_retries, trade_date=d)
        df_adj = df_adj[df_adj["ts_code"].isin(pool_codes)]
        for _, r in df_adj.iterrows():
            adj_map[(str(r["ts_code"]), str(r["trade_date"]))] = float(r["adj_factor"])

    if sorted_missing or sorted_adj_dates:
        print()

    stock_new_bars: dict[str, pd.DataFrame] = {}
    if daily_frames:
        df_all_new = pd.concat(daily_frames, ignore_index=True)
        for code, grp in df_all_new.groupby("ts_code"):
            stock_new_bars[str(code)] = grp.sort_values("trade_date").reset_index(drop=True)

    return stock_new_bars, adj_map


# ── Section 5 · 本地 CSV 状态扫描与原子写入层 ─────────────────────────────────

def atomic_save_csv(df: pd.DataFrame, out_file: str) -> int:
    """
    通过临时文件 + os.replace 原子写入 CSV：
    保证写入过程中若发生中断或异常，绝不损坏本地已有的历史 CSV。
    """
    missing_cols = set(ORDERED_COLS) - set(df.columns)
    if missing_cols:
        raise RuntimeError(f"待保存数据缺失列: {sorted(missing_cols)}")

    df_to_save = df[ORDERED_COLS]
    tmp_file = out_file + ".tmp"
    try:
        df_to_save.to_csv(tmp_file, index=False, encoding="utf-8-sig")
        os.replace(tmp_file, out_file)
    finally:
        if os.path.exists(tmp_file):
            os.remove(tmp_file)

    return int(df_to_save["换手率"].isna().sum())


def inspect_local_csv(csv_path: str) -> tuple[str, pd.DataFrame | None, str]:
    """
    检查本地已存在的个股 CSV 文件状态，返回 (status, df_local, last_trade_date)：
    - "need_full"        : 本地无文件、文件损坏、缺列、缺历史头部或非次新股预热行数不足
    - "up_to_date"       : 本地最新交易日已等于 REAL_END_DATE（若头部有多余旧日期则顺手裁剪）
    - "need_trim_end"    : 本地最新交易日大于 REAL_END_DATE（回测历史截面场景，需校验期间是否除权）
    - "need_incremental" : 本地数据健康且最新交易日小于 REAL_END_DATE，可走截面增量更新
    """
    if not os.path.exists(csv_path):
        return "need_full", None, ""

    try:
        df_local = pd.read_csv(csv_path, dtype={"交易日期": str, "代码": str, "名称": str, "所属行业": str})
    except Exception:
        return "need_full", None, ""

    if df_local.empty or not set(ORDERED_COLS).issubset(set(df_local.columns)):
        return "need_full", None, ""

    df_local["交易日期"] = df_local["交易日期"].astype(str)
    if not df_local["交易日期"].str.fullmatch(r"\d{8}").all():
        return "need_full", None, ""
    if df_local["交易日期"].duplicated().any():
        return "need_full", None, ""

    df_local = df_local.sort_values("交易日期").reset_index(drop=True)
    min_date = str(df_local["交易日期"].iloc[0])
    max_date = str(df_local["交易日期"].iloc[-1])

    # 判断是否为 DATA_START_DATE 之后才上市的次新股：上市首日 MA5 必为 NaN
    is_ipo_since_start = pd.isna(df_local["MA5"].iloc[0])

    # 若本地最早日期晚于 FIRST_DATA_TRADE_DATE 且并非上市首日，说明用户把 DATA_START_DATE 改早了，需全量重拉
    if min_date > FIRST_DATA_TRADE_DATE and not is_ipo_since_start:
        return "need_full", None, ""

    # 过滤掉早于 DATA_START_DATE 的行後，检查剩余行数是否满足 120日低点与 EMA 收敛要求
    df_in_range = df_local[df_local["交易日期"] >= DATA_START_DATE].reset_index(drop=True)
    if df_in_range.empty:
        return "need_full", None, ""

    if len(df_in_range) < MIN_WARMUP_ROWS and not is_ipo_since_start:
        # 当历史窗口不足 MIN_WARMUP_ROWS 且非次新股时，增量重算无法还原预热期，需全量拉取
        return "need_full", None, ""

    if max_date == REAL_END_DATE:
        return "up_to_date", df_in_range, max_date
    if max_date > REAL_END_DATE:
        return "need_trim_end", df_in_range, max_date
    return "need_incremental", df_in_range, max_date


def process_full_stock(formatted_code: str, stock_name: str) -> int:
    """对单只股票执行全量拉取、全量计算指标并原子写入 CSV。"""
    df_raw = get_full_data(formatted_code)
    df_stock = calculate_all_indicators(df_raw)

    df_final = df_stock[
        (df_stock["trade_date"] >= DATA_START_DATE)
        & (df_stock["trade_date"] <= REAL_END_DATE)
    ].reset_index(drop=True)
    if df_final.empty:
        raise RuntimeError(f"数据在 {DATA_START_DATE} ~ {REAL_END_DATE} 内为空")

    industry_name = get_stock_industry(formatted_code)
    df_out = _format_output_df(df_final, formatted_code, stock_name, industry_name)

    out_file = os.path.join(STOCK_DIR, f"{formatted_code}.csv")
    missing_turnover = atomic_save_csv(df_out, out_file)
    if missing_turnover:
        print(f"\n[!] {formatted_code} 有 {missing_turnover} 个交易日缺少换手率，已留空，未填0。")
    return len(df_out)


# ── Section 6 · 主控调度引擎（支持 full / incremental / auto） ─────────────────

def main():
    mode = str(SYNC_MODE).strip().lower()
    if mode not in ("auto", "incremental", "full"):
        raise ValueError(f"未知的 SYNC_MODE 配置: {SYNC_MODE!r}，可选值为 'auto' | 'incremental' | 'full'")

    if not os.path.exists(POOL_FILE):
        raise RuntimeError("股票池文件不存在")

    stock_list = pd.read_csv(POOL_FILE, dtype={"ts_code": str})
    if STOCK_CODE_PREFIXES:
        stock_list = stock_list[
            stock_list["ts_code"].astype(str).str.strip().str.startswith(STOCK_CODE_PREFIXES)
        ]
    if stock_list.empty:
        raise RuntimeError("股票池为空")

    # 规范化股票池列表
    pool_records: list[tuple[str, str]] = []
    failures: list[tuple[str, str]] = []
    for _, row in stock_list.iterrows():
        raw_code = str(row["ts_code"])
        name = str(row.get("name", "") or "")
        try:
            formatted = format_ts_code(raw_code)
            pool_records.append((formatted, name))
        except Exception as exc:
            failures.append((raw_code, str(exc)))

    total = len(stock_list)
    print(f"\n{'-' * 68}")
    print(f"[模块触发] 股票池共 {total} 只 | 运行模式: [{mode.upper()}]")

    # ── 分支 A：强制全量模式 ("full") ──
    if mode == "full":
        success = 0
        for idx, (code, name) in enumerate(pool_records, start=1):
            pct = int(idx / total * 100)
            sys.stdout.write(f"\r[全量同步] {idx}/{total} [{pct}%] | {code} ")
            sys.stdout.flush()
            try:
                process_full_stock(code, name)
                success += 1
            except Exception as exc:
                failures.append((code, str(exc)))
                print(f"\n[×] {code} 全量同步失败，原CSV保持不变：{exc}")

        _print_summary(total, skipped=0, inc_success=0, full_success=success, failures=failures)
        return

    # ── 分支 B：智能增量 / 截面增量模式 ("auto" / "incremental") ──
    skipped_count = 0
    inc_success = 0
    full_success = 0

    full_queue: list[tuple[str, str, str]] = []                  # (code, name, reason)
    inc_queue: list[tuple[str, str, pd.DataFrame, str]] = []     # (code, name, df_old, last_date)
    trim_queue: list[tuple[str, str, pd.DataFrame, str]] = []    # (code, name, df_old, max_date)

    # 阶段 1：扫描本地 CSV 状态
    for code, name in pool_records:
        csv_path = os.path.join(STOCK_DIR, f"{code}.csv")
        status, df_local, last_date = inspect_local_csv(csv_path)

        if status == "up_to_date" and df_local is not None:
            # 若原文件头部含早于 DATA_START_DATE 的行，顺手保存裁剪后的版本
            atomic_save_csv(df_local, csv_path)
            skipped_count += 1
        elif status == "need_incremental" and df_local is not None:
            inc_queue.append((code, name, df_local, last_date))
        elif status == "need_trim_end" and df_local is not None:
            trim_queue.append((code, name, df_local, last_date))
        else:
            full_queue.append((code, name, "无本地缓存或需补齐历史预热"))

    print(
        f"[*] 本地扫描完成: 已是最新跳过 [{skipped_count}] 只 | "
        f"待截面增量 [{len(inc_queue)}] 只 | 待全量重拉 [{len(full_queue)}] 只"
    )

    # 阶段 2：按日期横截面批量增量更新
    if inc_queue or trim_queue:
        # 收集所有缺失的交易日与需要校验复权因子的锚定日期
        all_missing_dates: set[str] = set()
        adj_check_dates: set[str] = {REAL_END_DATE}
        for _, _, _, last_dt in inc_queue:
            adj_check_dates.add(last_dt)
            for d in TRADE_CALENDAR:
                if last_dt < d <= REAL_END_DATE:
                    all_missing_dates.add(d)
        for _, _, _, max_dt in trim_queue:
            adj_check_dates.add(max_dt)

        missing_days_count = len(all_missing_dates)
        # 在 "auto" 模式下，若缺失交易日过多且按日期拉取请求数高于逐股请求数，则自动转为全量
        if mode == "auto" and (
            missing_days_count > INCREMENTAL_MAX_DAYS
            or (missing_days_count * 3 > (len(inc_queue) + len(trim_queue)) * 2 and len(inc_queue) > 0)
        ):
            print(f"[*] 缺失交易日达 {missing_days_count} 天，自动切换为逐股全量拉取...")
            for code, name, _, _ in inc_queue:
                full_queue.append((code, name, f"缺失天数({missing_days_count}天)超阈值转全量"))
            for code, name, _, _ in trim_queue:
                full_queue.append((code, name, "目标日期回退转全量"))
            inc_queue.clear()
            trim_queue.clear()
        else:
            target_codes = {c for c, _, _, _ in inc_queue} | {c for c, _, _, _ in trim_queue}
            try:
                stock_new_bars, adj_map = fetch_cross_section_by_dates(
                    missing_dates=sorted(all_missing_dates),
                    adj_check_dates=adj_check_dates,
                    pool_codes=target_codes,
                )

                # 处理历史截面回退裁剪 (need_trim_end)
                for code, name, df_old, max_dt in trim_queue:
                    adj_old = adj_map.get((code, max_dt))
                    adj_end = adj_map.get((code, REAL_END_DATE))
                    if adj_old is not None and adj_end is not None and np.isclose(adj_old, adj_end, rtol=1e-6, atol=1e-6):
                        df_trimmed = df_old[df_old["交易日期"] <= REAL_END_DATE].reset_index(drop=True)
                        if not df_trimmed.empty:
                            atomic_save_csv(df_trimmed, os.path.join(STOCK_DIR, f"{code}.csv"))
                            inc_success += 1
                        else:
                            full_queue.append((code, name, "裁剪后为空转全量"))
                    else:
                        full_queue.append((code, name, "区间内发生除权或复权因子缺失"))

                # 处理常规截面增量更新 (need_incremental)
                total_inc = len(inc_queue)
                for idx, (code, name, df_old, last_dt) in enumerate(inc_queue, start=1):
                    pct = int(idx / total_inc * 100)
                    sys.stdout.write(f"\r[截面增量] {idx}/{total_inc} [{pct}%] | {code} ")
                    sys.stdout.flush()

                    df_new_raw = stock_new_bars.get(code)
                    # 若该股在缺失交易日全部停牌无新行情
                    if df_new_raw is None or df_new_raw.empty:
                        inc_success += 1
                        continue

                    latest_stock_dt = str(df_new_raw["trade_date"].max())
                    adj_old = adj_map.get((code, last_dt))
                    adj_new = adj_map.get((code, latest_stock_dt))

                    # 核心校验：若缺失复权因子，或最新复权因子与本地最后一天不一致（发生分红送转除权），回退单股全量
                    if adj_old is None or adj_new is None or not np.isclose(adj_old, adj_new, rtol=1e-6, atol=1e-6):
                        full_queue.append((code, name, f"检测到除权除息(复权因子 {adj_old} -> {adj_new})"))
                        continue

                    try:
                        df_new_raw = _validate_kline_df(df_new_raw, source_label=f"{code}增量K线")
                        industry_name = get_stock_industry(code)
                        df_merged = append_incremental_indicators(
                            df_old=df_old,
                            df_new_raw=df_new_raw,
                            formatted_code=code,
                            stock_name=name,
                            industry_name=industry_name,
                        )
                        df_merged = df_merged[
                            (df_merged["交易日期"] >= DATA_START_DATE)
                            & (df_merged["交易日期"] <= REAL_END_DATE)
                        ].reset_index(drop=True)

                        out_file = os.path.join(STOCK_DIR, f"{code}.csv")
                        atomic_save_csv(df_merged, out_file)
                        inc_success += 1
                    except Exception as exc:
                        full_queue.append((code, name, f"增量拼接异常回退全量({exc})"))

                if total_inc > 0:
                    print()
            except Exception as exc:
                print(f"\n[!] 截面批量拉取失败 ({exc})，自动将待增量股票回退至单股全量队列...")
                for code, name, _, _ in inc_queue:
                    full_queue.append((code, name, "截面接口异常回退全量"))
                for code, name, _, _ in trim_queue:
                    full_queue.append((code, name, "截面接口异常回退全量"))

    # 阶段 3：执行单股全量拉取（针对新股、除权股、无本地文件或回退个股）
    if full_queue:
        total_full = len(full_queue)
        print(f"[*] 开始单股全量同步 (共 {total_full} 只：含新入池、历史补齐或发生除权个股)...")
        for idx, (code, name, reason) in enumerate(full_queue, start=1):
            pct = int(idx / total_full * 100)
            sys.stdout.write(f"\r[单股全量] {idx}/{total_full} [{pct}%] | {code} ({reason}) ")
            sys.stdout.flush()
            try:
                process_full_stock(code, name)
                full_success += 1
            except Exception as exc:
                failures.append((code, str(exc)))
                print(f"\n[×] {code} 全量同步失败，原CSV保持不变：{exc}")
        print()

    # 阶段 4：输出汇总统计
    _print_summary(
        total=total,
        skipped=skipped_count,
        inc_success=inc_success,
        full_success=full_success,
        failures=failures,
    )


def _print_summary(
    total: int,
    skipped: int,
    inc_success: int,
    full_success: int,
    failures: list[tuple[str, str]],
):
    """打印同步完成后的统计摘要。"""
    total_ok = skipped + inc_success + full_success
    print("-" * 68)
    print(
        f"[统计] 总成功 {total_ok}/{total} "
        f"(已最新跳过: {skipped} | 截面增量: {inc_success} | 单股全量: {full_success}) ；"
        f"失败 {len(failures)}/{total}"
    )
    print(f"[输出] CSV 目录: {STOCK_DIR}")
    if failures:
        print("[!] 以下股票未成功更新，原CSV未改动，请检查网络、权限或停牌/上市日期：")
        for code, err in failures:
            print(f"    {code}: {err}")
        raise RuntimeError(f"{len(failures)}只股票更新失败，停止发布并保留上一份公开数据。")
    else:
        print("[√] 全部股票行情与技术指标已同步落盘完毕！")


if __name__ == "__main__":
    main()
