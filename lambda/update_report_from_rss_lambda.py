# update_report_from_rss_lambda.py (AWS Lambda対応版)
import feedparser
import os
import boto3
import logging
from datetime import datetime, timedelta, timezone
from collections import defaultdict

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- 設定 (Lambda環境変数から取得することを推奨) ---
RSS_FEED_URL = os.environ.get(
    "RSS_FEED_URL", "https://aws.amazon.com/new/feed/"
)
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
S3_KEY_PREFIX = os.environ.get("S3_KEY_PREFIX", "reports/")

FILENAME_FORMAT = "{start_date}-{end_date}-aws-weekly-update-report.md"
DATE_HEADING_FORMAT = "## {year}年{month}月{day}日"
ENTRY_FORMAT = "- [**{title}**]({link})"
JST = timezone(timedelta(hours=+9), "JST")

s3_client = boto3.client("s3")
translate_client = boto3.client("translate") # Amazon Translate クライアントを追加

def get_previous_week_dates(today_jst):
    """スクリプト実行日の前の週の月曜と日曜の日付オブジェクト(JST)とYYYYMMDD文字列を返す"""
    days_since_monday = today_jst.weekday()  # 月曜=0, 日曜=6
    last_sunday = today_jst - timedelta(days=days_since_monday + 1)
    last_monday = last_sunday - timedelta(days=6)
    last_monday = last_monday.replace(tzinfo=JST)
    last_sunday = last_sunday.replace(tzinfo=JST)
    return (
        last_monday,
        last_sunday,
        last_monday.strftime("%Y%m%d"),
        last_sunday.strftime("%Y%m%d"),
    )


def format_date_heading(date_obj):
    """日付オブジェクトを日本語の日付見出し形式(## YYYY年MM月DD日)に変換"""
    if isinstance(date_obj, datetime):
        return DATE_HEADING_FORMAT.format(
            year=date_obj.year, month=date_obj.month, day=date_obj.day
        )
    else:
        return DATE_HEADING_FORMAT.format(
            year=date_obj.year, month=date_obj.month, day=date_obj.day
        )


def parse_published_date(published_string):
    """RSSフィードの日付文字列をdatetimeオブジェクト(JST)に変換"""
    try:
        try:
            dt_utc = datetime.strptime(
                published_string, "%a, %d %b %Y %H:%M:%S %z"
            )
        except ValueError:
            dt_utc = datetime.strptime(
                published_string, "%a, %d %b %Y %H:%M:%S GMT"
            )
            dt_utc = dt_utc.replace(tzinfo=timezone.utc)
        return dt_utc.astimezone(JST)
    except ValueError:
        return None


def generate_report_content(entries_by_date, start_date_obj, end_date_obj):
    """日付ごとにグループ化されたエントリからレポート内容(Markdown)を生成"""
    lines = []
    title = (
        f"# AWS 週次更新レポート（{start_date_obj.strftime('%Y年%m月%d日')}～"
        f"{end_date_obj.strftime('%Y年%m月%d日')}）- 日付順"
    )
    lines.append(title + "\n\n")
    sorted_dates = sorted(entries_by_date.keys(), reverse=True)
    for entry_date in sorted_dates:
        lines.append(format_date_heading(entry_date) + "\n\n")
        sorted_entries = sorted(
            entries_by_date[entry_date], key=lambda x: x["title"]
        )
        for entry in sorted_entries:
            try:
                # タイトルを日本語に翻訳
                translate_response = translate_client.translate_text(
                    Text=entry["title"],
                    SourceLanguageCode="en",
                    TargetLanguageCode="ja",
                )
                translated_title = translate_response.get("TranslatedText", entry["title"])
            except Exception as e:
                logger.warning(f"翻訳エラー: {entry['title']} - {e}")
                translated_title = entry["title"] # エラー時は元のタイトルを使用

            escaped_title = (
                translated_title
                .replace("*", "\\*")
                .replace("_", "\\_")
                .replace("`", "\\`")
            )
            entry_md = ENTRY_FORMAT.format(title=escaped_title, link=entry["link"])
            lines.append(entry_md + "\n")
        lines.append("\n")
    while lines and lines[-1].strip() == "":
        lines.pop()
    lines.append("\n")
    return "".join(lines)


# --- Lambdaハンドラー ---


def lambda_handler(event, context):
    logger.info("処理開始...")

    if not S3_BUCKET_NAME:
        logger.error("環境変数 S3_BUCKET_NAME が設定されていません。")
        return {"statusCode": 500, "body": "S3_BUCKET_NAME is not set"}

    today = datetime.now(JST)
    prev_monday, prev_sunday, prev_monday_str, prev_sunday_str = (
        get_previous_week_dates(today)
    )

    logger.info(
        f"対象週: {prev_monday.strftime('%Y/%m/%d')} - "
        f"{prev_sunday.strftime('%Y/%m/%d')}"
    )
    logger.info(f"AWS What's New RSSフィード ({RSS_FEED_URL}) を取得中...")
    feed = feedparser.parse(RSS_FEED_URL)

    if feed.bozo:
        logger.warning(
            f"RSSフィードの解析に問題がある可能性があります: {feed.bozo_exception}"
        )

    if not feed.entries:
        logger.error("RSSフィードからエントリを取得できませんでした。")
        return {
            "statusCode": 500,
            "body": "Failed to retrieve RSS feed entries",
        }

    logger.info(f"{len(feed.entries)} 件のエントリを処理します...")

    entries_for_last_week = defaultdict(list)
    processed_count = 0

    for entry in feed.entries:
        published_str = entry.get("published")
        if not published_str:
            continue
        published_date = parse_published_date(published_str)
        if not published_date:
            continue
        if prev_monday.date() <= published_date.date() <= prev_sunday.date():
            entry_data = {"title": entry.title, "link": entry.link}
            entries_for_last_week[published_date.date()].append(entry_data)
            processed_count += 1

    if not entries_for_last_week:
        logger.info("先週公開された新しいエントリは見つかりませんでした。")
        return {
            "statusCode": 200,
            "body": "No new entries found for the last week.",
        }

    logger.info(
        f"先週のエントリを {processed_count} 件見つけました。"
        "レポートファイルを生成します..."
    )

    report_filename = FILENAME_FORMAT.format(
        start_date=prev_monday_str, end_date=prev_sunday_str
    )
    s3_key = S3_KEY_PREFIX + report_filename
    if S3_KEY_PREFIX and not S3_KEY_PREFIX.endswith("/"): 
        s3_key = S3_KEY_PREFIX + "/" + report_filename

    report_content = generate_report_content(
        entries_for_last_week, prev_monday, prev_sunday
    )

    try:
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            Body=report_content,
            ContentType="text/markdown; charset=utf-8",
        )
        logger.info(
            f"レポートファイルをS3にアップロードしました: s3://{S3_BUCKET_NAME}/{s3_key}"
        )
    except Exception as e:
        logger.error(
            f"S3へのファイルアップロード中にエラーが発生しました "
            f"(s3://{S3_BUCKET_NAME}/{s3_key}): {e}"
        )
        return {
            "statusCode": 500,
            "body": f"Error uploading to S3: {e}",
        }

    logger.info("処理完了。")
    return {
        "statusCode": 200,
        "body": (
            f"Report generated and uploaded to "
            f"s3://{S3_BUCKET_NAME}/{s3_key}"
        ),
    }
