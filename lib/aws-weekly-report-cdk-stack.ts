import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha'; // PythonFunction用 (PythonLayerVersion は未使用なので削除)
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3 from 'aws-cdk-lib/aws-s3'; // S3モジュールをインポート
import * as path from 'path';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'; // S3イベントソース用に追加

export interface AwsWeeklyReportCdkStackProps extends cdk.StackProps {
  /**
   * Base name for the S3 bucket where the report will be stored.
   * The AWS Account ID will be appended to this base name.
   * e.g., 'my-aws-weekly-reports'
   */
  readonly reportOutputS3BucketBaseName: string;

  /**
   * S3 key prefix for the generated report within the output bucket.
   * @default 'reports/'
   */
  readonly reportOutputS3KeyPrefix?: string;

  /**
   * URL of the RSS feed to process.
   * @default 'https://aws.amazon.com/new/feed/'
   */
  readonly rssFeedUrl?: string;

  /**
   * CloudWatch Events schedule expression.
   * For "Every Tuesday at 07:00 JST", this is "cron(0 22 ? * MON *)" in UTC.
   * @default 'cron(0 22 ? * MON *)' // Every Tuesday at 07:00 JST (which is Monday 22:00 UTC)
   */
  readonly scheduleExpression?: string;

  /**
   * Lambda function timeout in seconds.
   * @default 60
   */
  readonly lambdaTimeoutSeconds?: number;

  /**
   * Lambda function memory size in MB.
   * @default 256
   */
  readonly lambdaMemoryMB?: number;

  /**
   * Name for the Lambda function.
   * @default 'AwsWeeklyUpdateReportCdkFunction'
   */
  readonly lambdaFunctionName?: string;

  /**
   * Slack Incoming Webhook URL for S3 event notifications.
   * If not provided during CDK synthesis, the following default URL will be used:
   * This allows the stack to be deployed without explicitly setting the URL,
   * but it's recommended to provide a specific URL for production environments.
   */
  readonly slackWebhookUrl?: string; // Slack通知用に追加 (オプショナルに変更)

  /**
   * Expiration time in seconds for S3 pre-signed URLs in Slack notifications.
   * @default 3600 (1 hour)
   */
  readonly presignedUrlExpirationSeconds?: number; // Slack通知用に追加
}

export class AwsWeeklyReportCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsWeeklyReportCdkStackProps) {
    super(scope, id, props);

    const lambdaFunctionName = props.lambdaFunctionName ?? 'AwsWeeklyUpdateReportCdkFunction';
    const s3BucketBaseName = props.reportOutputS3BucketBaseName;
    // S3バケット名にアカウントIDを付加
    const reportOutputS3BucketName = `${s3BucketBaseName}-${this.account}`;

    // S3バケットを作成
    const reportBucket = new s3.Bucket(this, 'ReportOutputBucket', {
      bucketName: reportOutputS3BucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // スタック削除時にバケットも削除 (開発用)
      autoDeleteObjects: true, // スタック削除時にバケット内のオブジェクトも自動削除 (開発用)
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // パブリックアクセスをブロック (推奨)
      encryption: s3.BucketEncryption.S3_MANAGED, // S3管理キーによる暗号化
    });

    const reportOutputS3KeyPrefix = props.reportOutputS3KeyPrefix ?? 'reports/';
    const rssFeedUrl = props.rssFeedUrl ?? 'https://aws.amazon.com/new/feed/';
    const scheduleExpression = props.scheduleExpression ?? 'cron(0 22 ? * MON *)'; // Default to Monday 22:00 UTC (Tuesday 07:00 JST)
    const lambdaTimeout = cdk.Duration.seconds(props.lambdaTimeoutSeconds ?? 60);
    const lambdaMemory = props.lambdaMemoryMB ?? 256;

    // IAM Role for Lambda
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `${lambdaFunctionName}-ExecutionRole-${this.region}`, // リージョンを含めて一意性を高める
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add S3 write permission to the role for the created bucket
    // reportBucket.grantWrite(lambdaRole, reportOutputS3KeyPrefix + '*'); // こちらの方がより厳密
    // または、従来通りポリシーを直接追加
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [reportBucket.arnForObjects(`${reportOutputS3KeyPrefix}*`)], // バケットARNとプレフィックスを指定
    }));

    // Add Translate permission to the role
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['translate:TranslateText'],
      resources: ['*'], // TranslateTextは特定リソースへの制限が難しいためワイルドカードを使用
    }));
    
    // Lambda Function (using PythonFunction for automatic dependency bundling)
    const weeklyReportFunction = new PythonFunction(this, 'WeeklyReportLambda', {
      functionName: lambdaFunctionName,
      entry: path.join(__dirname, '../lambda'), // Path to the lambda directory
      runtime: lambda.Runtime.PYTHON_3_9,
      index: 'update_report_from_rss_lambda.py', // Name of the Python file (WITH .py)
      handler: 'lambda_handler', // Name of the handler function
      role: lambdaRole,
      environment: {
        S3_BUCKET_NAME: reportBucket.bucketName, // 作成したバケット名を参照
        S3_KEY_PREFIX: reportOutputS3KeyPrefix,
        RSS_FEED_URL: rssFeedUrl,
      },
      timeout: lambdaTimeout,
      memorySize: lambdaMemory,
      bundling: {
        // If you have specific Docker options or build arguments
        // dockerOptions: {
        //   platform: 'linux/amd64', // For M1/M2 Macs if building locally for Lambda
        // },
      }
    });

    // EventBridge Rule (CloudWatch Events)
    const rule = new events.Rule(this, 'ScheduledTriggerRule', {
      ruleName: `${lambdaFunctionName}-CronTrigger`,
      schedule: events.Schedule.expression(scheduleExpression),
    });

    // Add Lambda as a target for the EventBridge rule
    rule.addTarget(new targets.LambdaFunction(weeklyReportFunction));

    // Outputs
    new cdk.CfnOutput(this, 'LambdaFunctionNameOutput', {
      value: weeklyReportFunction.functionName,
      description: 'Name of the Lambda function',
    });
    new cdk.CfnOutput(this, 'LambdaFunctionArnOutput', {
      value: weeklyReportFunction.functionArn,
      description: 'ARN of the Lambda function',
    });
    new cdk.CfnOutput(this, 'IAMRoleArnOutput', {
      value: lambdaRole.roleArn,
      description: 'ARN of the IAM role for the Lambda function',
    });
    new cdk.CfnOutput(this, 'EventRuleNameOutput', {
        value: rule.ruleName,
        description: 'Name of the EventBridge Rule',
    });
    new cdk.CfnOutput(this, 'ReportOutputS3BucketName', { // 出力キー名を変更
        value: reportBucket.bucketName, // 作成したバケット名を出力
        description: 'Name of the S3 Bucket created for reports',
    });
    new cdk.CfnOutput(this, 'ReportOutputS3BucketArn', { // バケットARNも出力
        value: reportBucket.bucketArn,
        description: 'ARN of the S3 Bucket created for reports',
    });

    // --- S3 to Slack Notifier Lambda ---

    const baseLambdaFunctionName = props.lambdaFunctionName ?? 'AwsWeeklyUpdateReportCdkFunction'; // lambdaFunctionName を base として使用
    const s3ToSlackNotifierFunctionName = `${baseLambdaFunctionName}-S3SlackNotify`; // 短縮
    const presignedUrlExpiration = props.presignedUrlExpirationSeconds ?? 604800; // デフォルトを7日間に変更 (7*24*60*60 = 604800)
    const slackWebhookUrl = props.slackWebhookUrl;

    // IAM Role for S3 to Slack Notifier Lambda
    const s3ToSlackNotifierRole = new iam.Role(this, 'S3ToSlackNotifierLambdaRole', {
      roleName: `${s3ToSlackNotifierFunctionName}-Role-${this.region}`, // 短縮 (-ExecutionRole -> -Role)
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant S3 GetObject and HeadObject permission for the specific prefix
    s3ToSlackNotifierRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:HeadObject'],
      resources: [reportBucket.arnForObjects(`${reportOutputS3KeyPrefix}*`)],
    }));

    // S3 to Slack Notifier Lambda Function
    const s3ToSlackNotifierFunction = new PythonFunction(this, 'S3ToSlackNotifierLambda', {
      functionName: s3ToSlackNotifierFunctionName, // 更新された関数名を使用
      entry: path.join(__dirname, '../lambda'),
      runtime: lambda.Runtime.PYTHON_3_9,
      index: 's3_to_slack_notifier_lambda.py',
      handler: 'lambda_handler',
      role: s3ToSlackNotifierRole,
      environment: {
        SLACK_WEBHOOK_URL: slackWebhookUrl ?? '',
        PRESIGNED_URL_EXPIRATION: presignedUrlExpiration.toString(),
        S3_KEY_PREFIX: reportOutputS3KeyPrefix,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
    });

    // Add S3 event notification to trigger the S3ToSlackNotifierLambda
    // S3イベント通知の送信先としてLambda関数を指定する際に、aws-cdk-lib/aws-s3-notifications の LambdaDestination を使うのが一般的
    // しかし、PythonFunction を使っている場合、直接 addEventNotification で lambda.Function を渡せる
    // もし aws-s3-notifications を使う場合は import * as s3n from 'aws-cdk-lib/aws-s3-notifications'; が必要
    // reportBucket.addEventNotification(
    //   s3.EventType.OBJECT_CREATED,
    //   new s3n.LambdaDestination(s3ToSlackNotifierFunction), // 正しくは LambdaDestination を使う
    //   { prefix: reportOutputS3KeyPrefix }
    // );
    // Lambda 関数にイベントソースを追加する形で定義する（こちらの方がシンプル）
    s3ToSlackNotifierFunction.addEventSource(new lambdaEventSources.S3EventSource(reportBucket, {
        events: [ s3.EventType.OBJECT_CREATED ],
        filters: [ { prefix: reportOutputS3KeyPrefix } ]
    }));


    // Outputs for the new Lambda
    new cdk.CfnOutput(this, 'S3ToSlackNotifierLambdaNameOutput', {
      value: s3ToSlackNotifierFunction.functionName,
      description: 'Name of the S3 to Slack Notifier Lambda function',
    });
    new cdk.CfnOutput(this, 'S3ToSlackNotifierLambdaArnOutput', {
      value: s3ToSlackNotifierFunction.functionArn,
      description: 'ARN of the S3 to Slack Notifier Lambda function',
    });
    new cdk.CfnOutput(this, 'S3ToSlackNotifierIAMRoleArnOutput', {
      value: s3ToSlackNotifierRole.roleArn,
      description: 'ARN of the IAM role for the S3 to Slack Notifier Lambda function',
    });
  }
}
