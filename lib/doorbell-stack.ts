import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

export interface DoorbellStackProps extends cdk.StackProps {
  phoneNumbers: string[];
}

export class DoorbellStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DoorbellStackProps) {
    super(scope, id, props);

    const topic = new sns.Topic(this, 'DoorbellTopic', {
      displayName: 'Community Doorbell Notifications',
    });

    for (const phone of props.phoneNumbers) {
      topic.addSubscription(new subscriptions.SmsSubscription(phone));
    }

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    const doorbellFn = new lambda.Function(this, 'DoorbellFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        CONFIG_BUCKET: siteBucket.bucketName,
        CONFIG_KEY: 'config.json',
        TOPIC_ARN: topic.topicArn,
      },
      timeout: cdk.Duration.seconds(10),
    });

    siteBucket.grantRead(doorbellFn, 'config.json');
    topic.grantPublish(doorbellFn);

    const httpApi = new apigw.HttpApi(this, 'DoorbellApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST],
        allowHeaders: ['Content-Type'],
      },
    });

    const stage = httpApi.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.addPropertyOverride('DefaultRouteSettings', {
      ThrottlingRateLimit: 1,
      ThrottlingBurstLimit: 5,
    });

    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      'LambdaIntegration',
      doorbellFn
    );

    httpApi.addRoutes({
      path: '/ring',
      methods: [apigw.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/status',
      methods: [apigw.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset('./frontend'),
        s3deploy.Source.jsonData('runtime-config.json', {
          apiUrl: httpApi.url,
        }),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'DoorbellURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Doorbell page URL — share this with event attendees',
    });

    new cdk.CfnOutput(this, 'ApiURL', {
      value: httpApi.url!,
      description: 'API Gateway endpoint',
    });

    new cdk.CfnOutput(this, 'ConfigToggleCommand', {
      value: `echo '{"active":true,"message":"Someone is at the door!"}' | aws s3 cp - s3://${siteBucket.bucketName}/config.json`,
      description: 'Run this to activate the doorbell',
    });
  }
}
