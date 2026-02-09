import json
import os
import urllib3
import urllib.parse # 標準ライブラリのurllib.parseをインポート
import boto3
from botocore.exceptions import ClientError
import logging
from datetime import datetime, timezone, timedelta

# Loggerの設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# SlackのIncoming Webhook URLを環境変数から取得
SLACK_WEBHOOK_URL = os.environ.get('SLACK_WEBHOOK_URL')
# 署名付きURLの有効期限（秒）
PRESIGNED_URL_EXPIRATION = int(os.environ.get('PRESIGNED_URL_EXPIRATION', 604800))  # デフォルト7日間 (7*24*60*60 = 604800)
# S3キープレフィックス
S3_KEY_PREFIX = os.environ.get('S3_KEY_PREFIX', 'reports/')

http = urllib3.PoolManager()
s3_client = boto3.client('s3')
JST = timezone(timedelta(hours=+9), "JST")

def create_presigned_url(bucket_name, object_key, expiration=PRESIGNED_URL_EXPIRATION):
    """S3署名付きURLを生成する"""
    try:
        response = s3_client.generate_presigned_url('get_object',
                                                    Params={'Bucket': bucket_name,
                                                            'Key': object_key},
                                                    ExpiresIn=expiration)
    except ClientError as e:
        logger.error(f"Error generating presigned URL for s3://{bucket_name}/{object_key}: {e}")
        return None
    return response

def get_object_metadata(bucket_name, object_key):
    """S3オブジェクトのメタデータを取得する"""
    try:
        response = s3_client.head_object(Bucket=bucket_name, Key=object_key)
        return response
    except ClientError as e:
        logger.error(f"Error getting metadata for s3://{bucket_name}/{object_key}: {e}")
        return None

def lambda_handler(event, context):
    if not SLACK_WEBHOOK_URL:
        logger.error("SLACK_WEBHOOK_URL is not set in environment variables.")
        return {'statusCode': 500, 'body': json.dumps('SLACK_WEBHOOK_URL not configured')}

    logger.info(f"Received event: {json.dumps(event)}")

    try:
        for record in event.get('Records', []):
            s3_event = record.get('s3', {})
            bucket_name = s3_event.get('bucket', {}).get('name')
            object_key = s3_event.get('object', {}).get('key')

            if not bucket_name or not object_key:
                logger.warning("Bucket name or object key not found in S3 event record.")
                continue

            # URLデコードが必要な場合があるため適用 (urllib.parseを使用)
            object_key = urllib.parse.unquote_plus(object_key)

            logger.info(f"Processing object s3://{bucket_name}/{object_key}")

            # S3_KEY_PREFIX でフィルタリング (S3イベント通知側でも設定するが念のため)
            if not object_key.startswith(S3_KEY_PREFIX):
                 logger.info(f"Object {object_key} does not match prefix '{S3_KEY_PREFIX}'. Skipping.")
                 continue

            # オブジェクトのメタデータを取得
            metadata = get_object_metadata(bucket_name, object_key)
            object_size_bytes = metadata.get('ContentLength', 'N/A') if metadata else 'N/A'
            last_modified_utc_str = metadata.get('LastModified').isoformat() if metadata and metadata.get('LastModified') else 'N/A'
            
            last_modified_jst_str = "N/A"
            if metadata and metadata.get('LastModified'):
                last_modified_utc = metadata.get('LastModified')
                last_modified_jst = last_modified_utc.astimezone(JST)
                last_modified_jst_str = last_modified_jst.strftime('%Y年%m月%d日 %H:%M:%S JST')


            # 署名付きURLを生成
            download_url = create_presigned_url(bucket_name, object_key)

            if not download_url:
                slack_message_text = f"S3バケット '{bucket_name}' の '{object_key}' に新しいオブジェクトが作成されましたが、ダウンロードリンクの生成に失敗しました。"
                slack_payload = {'text': slack_message_text}
            else:
                file_name_only = object_key.split('/')[-1] # パスからファイル名のみ抽出

                blocks = [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": (
                                f"新しいレポートがアップロードされました！\n"
                                f"*ファイル名:* `{file_name_only}`\n"
                                f"*パス:* `s3://{bucket_name}/{object_key}`\n"
                                f"*サイズ:* `{object_size_bytes} bytes`\n"
                                f"*最終更新日時:* `{last_modified_jst_str}`"
                            )
                        }
                    }
                ]

                # 画像ファイルの場合、プレビューを試みる
                is_image = any(object_key.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif'])
                if is_image:
                    blocks.append({
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": file_name_only
                        },
                        "image_url": download_url,
                        "alt_text": f"Preview of {file_name_only}"
                    })

                blocks.extend([
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": "ファイルをダウンロード 📥",
                                    "emoji": True
                                },
                                "url": download_url,
                                "style": "primary"
                            }
                        ]
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"このダウンロードリンクは {PRESIGNED_URL_EXPIRATION // 3600} 時間有効です。"
                            }
                        ]
                    }
                ])
                slack_payload = {"blocks": blocks}

            # Slackにメッセージを送信
            response = http.request(
                'POST',
                SLACK_WEBHOOK_URL,
                body=json.dumps(slack_payload),
                headers={'Content-Type': 'application/json; charset=utf-8'}, # charset=utf-8 を追加
                retries=False
            )
            logger.info(f"Slack API response: Status={response.status}, Data={response.data.decode('utf-8')}")
            if response.status >= 300:
                 logger.error(f"Error sending message to Slack: {response.status} {response.data.decode('utf-8')}")


        return {
            'statusCode': 200,
            'body': json.dumps('Slack notification(s) processed.')
        }

    except Exception as e:
        logger.error(f"Error processing S3 event or sending to Slack: {e}", exc_info=True)
        try:
            error_message_to_slack = {
                'text': f"S3イベント処理中にエラーが発生しました: {str(e)}"
            }
            http.request(
                'POST',
                SLACK_WEBHOOK_URL,
                body=json.dumps(error_message_to_slack),
                headers={'Content-Type': 'application/json; charset=utf-8'},
                retries=False
            )
        except Exception as slack_error:
            logger.error(f"Failed to send error message to Slack: {slack_error}", exc_info=True)
        # raise # エラーを再raiseするとLambdaがリトライする可能性があるため、ここではしない。DLQで処理を検討。
        return {'statusCode': 500, 'body': json.dumps(f'Error: {str(e)}')}

if __name__ == '__main__':
    # ローカルテスト用のダミーイベント
    sample_event = {
      "Records": [
        {
          "eventVersion": "2.1",
          "eventSource": "aws:s3",
          "awsRegion": "ap-northeast-1",
          "eventTime": "2023-10-27T10:00:00.000Z",
          "eventName": "ObjectCreated:Put",
          "userIdentity": {
            "principalId": "EXAMPLE"
          },
          "requestParameters": {
            "sourceIPAddress": "127.0.0.1"
          },
          "responseElements": {
            "x-amz-request-id": "EXAMPLE123456789",
            "x-amz-id-2": "EXAMPLE123/56789"
          },
          "s3": {
            "s3SchemaVersion": "1.0",
            "configurationId": "testConfigRule",
            "bucket": {
              "name": "my-aws-weekly-reports-123456789012", # 実際のバケット名に置き換える
              "ownerIdentity": {
                "principalId": "EXAMPLE"
              },
              "arn": "arn:aws:s3:::my-aws-weekly-reports-123456789012" # 実際のバケットARN
            },
            "object": {
              "key": "report/20231023-20231029-aws-weekly-update-report.md", # report/ プレフィックスをつける
              "size": 1024,
              "eTag": "0123456789abcdef0123456789abcdef",
              "sequencer": "0A1B2C3D4E5F678901"
            }
          }
        }
      ]
    }
    # 環境変数を設定 (ローカルテスト用)
    os.environ['SLACK_WEBHOOK_URL'] = "YOUR_SLACK_WEBHOOK_URL_HERE" # ここに実際のWebhook URLを設定
    os.environ['PRESIGNED_URL_EXPIRATION'] = "604800" # ローカルテスト時も7日間に変更

    if os.environ['SLACK_WEBHOOK_URL'] == "YOUR_SLACK_WEBHOOK_URL_HERE":
        print("SLACK_WEBHOOK_URLを環境変数に設定してください。")
    else:
        lambda_handler(sample_event, None)
