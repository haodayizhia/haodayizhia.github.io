import os
import glob
import pandas as pd

# ================= 1. 全局配置区（原样保留） =================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 路径配置
INPUT_FOLDER = os.path.join(BASE_DIR, "stock_data")
OUTPUT_FILE = os.path.join(BASE_DIR, "merged_stock_data.csv")

# 日期筛选配置 (格式: YYYYMMDD)
# 提示: 若需合并全部历史数据，请将起始与结束日期均设为 None
START_DATE = 20260101
END_DATE = None
# ===========================================================


def _validate_date_setting(value, field_name):
    if value is None:
        return None
    date = str(value)
    if len(date) != 8 or not date.isdigit() or pd.isna(pd.to_datetime(date, format='%Y%m%d', errors='coerce')):
        raise ValueError(f'{field_name} 必须是有效的 YYYYMMDD 日期: {value!r}')
    return date


def _read_csv(file_path):
    # 修复：先试 utf-8-sig，避免 UTF-8 中文表头被错误编码解读。
    last_error = None
    for encoding in ('utf-8-sig', 'utf-8', 'gb18030'):
        try:
            return pd.read_csv(file_path, encoding=encoding, dtype={
                '代码': str,
                '交易日期': str,
            })
        except UnicodeDecodeError as exc:
            last_error = exc
    raise RuntimeError(f'文件编码无法识别: {last_error}')


def merge_stock_data(input_dir, output_file, start_date=None, end_date=None):
    """合并个股CSV；拒绝混合旧版字段或有错误的源文件。"""
    start = _validate_date_setting(start_date, 'START_DATE')
    end = _validate_date_setting(end_date, 'END_DATE')
    if start is not None and end is not None and start > end:
        raise ValueError('START_DATE 不能晚于 END_DATE')

    file_list = sorted(glob.glob(os.path.join(input_dir, '*.csv')))
    if not file_list:
        print(f"提示: 目录 '{input_dir}' 下未找到 CSV 文件。")
        return False

    print(f'运行状态: 日期范围 [{start or "不限"} - {end or "不限"}]，源文件 {len(file_list)} 个')
    required_cols = {'代码', '交易日期', '成交量(万股)', '最高价', '最低价',
                     '5日量比', '距120日低点涨幅%', 'MACD柱'}
    merged_data = []
    problems = []
    reference_columns = None

    for file in file_list:
        basename = os.path.basename(file)
        try:
            df = _read_csv(file)
            if df.empty:
                raise ValueError('源CSV没有数据行')

            missing = required_cols - set(df.columns)
            if missing:
                raise ValueError(f'缺少新版字段 {sorted(missing)}；请先重新运行对应的行情获取脚本')

            # 修复：旧版和新版文件不能混合合并，避免生成大量隐式空字段。
            if reference_columns is None:
                reference_columns = list(df.columns)
            elif list(df.columns) != reference_columns:
                raise ValueError('CSV表头与其他文件不一致；请先完成全量同步')

            dates = df['交易日期']
            if dates.isna().any() or not dates.str.fullmatch(r'\d{8}').all():
                raise ValueError('交易日期包含空值或非YYYYMMDD格式')
            if pd.to_datetime(dates, format='%Y%m%d', errors='coerce').isna().any():
                raise ValueError('存在无效的日历日期')

            code = df['代码']
            if code.isna().any() or code.astype(str).str.strip().eq('').any():
                raise ValueError('代码包含缺失值')
            if df.duplicated(subset=['代码', '交易日期']).any():
                raise ValueError('源CSV存在重复的代码+交易日期')

            # 源文件名与表内代码应该一致，防止把重命名/混放的CSV错误合并。
            expected_code = os.path.splitext(basename)[0]
            if not code.astype(str).eq(expected_code).all():
                raise ValueError(f'文件名代码 {expected_code} 与内容不一致')

            mask = pd.Series(True, index=df.index)
            if start is not None:
                mask &= dates >= start
            if end is not None:
                mask &= dates <= end
            selected = df.loc[mask]
            if not selected.empty:
                merged_data.append(selected)
        except Exception as exc:
            problems.append((basename, str(exc)))
            print(f'[×] {basename}: {exc}')

    # 不把部分成功的文件写成“完整合并结果”；失败时旧合并文件保持原样。
    if problems:
        print(f'[!] {len(problems)} 个源文件存在问题，本次没有覆盖 {output_file}')
        return False
    if not merged_data:
        print('提示: 没有符合指定日期范围的数据；旧合并文件不变。')
        return False

    final_df = pd.concat(merged_data, ignore_index=True)
    duplicate_mask = final_df.duplicated(subset=['代码', '交易日期'])
    if duplicate_mask.any():
        print(f'[!] 合并结果中发现 {int(duplicate_mask.sum())} 条重复代码+日期，本次不覆盖。')
        return False

    final_df.sort_values(by=['交易日期', '代码'], inplace=True, kind='stable')
    final_df.reset_index(drop=True, inplace=True)

    # 临时文件写完再替换，防止写盘异常破坏已有结果。
    temp_file = output_file + '.tmp'
    try:
        final_df.to_csv(temp_file, index=False, encoding='utf-8-sig')
        os.replace(temp_file, output_file)
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)

    print('-' * 30)
    print(f'合并成功！有效源文件: {len(merged_data)}/{len(file_list)}')
    print(f'总数据量: {len(final_df)} 行')
    print(f'保存路径: {output_file}')
    return True


if __name__ == "__main__":
    merge_stock_data(INPUT_FOLDER, OUTPUT_FILE, START_DATE, END_DATE)
