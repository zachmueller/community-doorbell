import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';

export interface DoorbellStackProps extends cdk.StackProps {
  phoneNumbers?: string[];
  emailAddresses?: string[];
  ntfyTopic?: string;
  domainName?: string;
  hostedZoneId?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  adminEmails?: string[];
}

export class DoorbellStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DoorbellStackProps) {
    super(scope, id, props);

    const topic = new sns.Topic(this, 'DoorbellTopic', {
      displayName: 'Community Doorbell Notifications',
    });

    for (const phone of props.phoneNumbers ?? []) {
      topic.addSubscription(new subscriptions.SmsSubscription(phone));
    }

    for (const email of props.emailAddresses ?? []) {
      topic.addSubscription(new subscriptions.EmailSubscription(email));
    }

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    let certificate: acm.ICertificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;

    if (props.domainName && props.hostedZoneId) {
      const zoneName = props.domainName.split('.').slice(-2).join('.');
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName,
      });
      certificate = new acm.Certificate(this, 'Certificate', {
        domainName: props.domainName,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    const urlRewriteFn = new cloudfront.Function(this, 'UrlRewriteFunction', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri !== '/' && !uri.includes('.')) {
    request.uri = uri + '.html';
  }
  return request;
}
`),
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{
          function: urlRewriteFn,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      defaultRootObject: 'index.html',
      ...(props.domainName && { domainNames: [props.domainName] }),
      ...(certificate && { certificate }),
    });

    if (hostedZone && props.domainName) {
      new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(distribution)
        ),
      });
    }

    const doorbellFn = new lambda.Function(this, 'DoorbellFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        CONFIG_BUCKET: siteBucket.bucketName,
        CONFIG_KEY: 'config.json',
        TOPIC_ARN: topic.topicArn,
        ...(props.ntfyTopic && { NTFY_TOPIC: props.ntfyTopic }),
      },
      timeout: cdk.Duration.seconds(10),
    });

    siteBucket.grantRead(doorbellFn, 'config.json');
    topic.grantPublish(doorbellFn);

    const httpApi = new apigw.HttpApi(this, 'DoorbellApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
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

    const siteUrl = props.domainName
      ? `https://${props.domainName}`
      : `https://${distribution.distributionDomainName}`;

    const runtimeConfig: Record<string, string> = { apiUrl: httpApi.url! };

    if (props.googleClientId && props.googleClientSecret) {
      const preSignupFn = new lambda.Function(this, 'PreSignupFunction', {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'admin_auth.handler',
        code: lambda.Code.fromAsset('lambda'),
        environment: {
          ALLOWLIST_BUCKET: siteBucket.bucketName,
        },
        timeout: cdk.Duration.seconds(5),
      });
      siteBucket.grantRead(preSignupFn, 'admin-allowlist.json');

      const userPool = new cognito.UserPool(this, 'AdminUserPool', {
        userPoolName: 'doorbell-admin-pool',
        selfSignUpEnabled: true,
        signInAliases: { email: true },
        lambdaTriggers: { preSignUp: preSignupFn },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const userPoolDomain = userPool.addDomain('AdminDomain', {
        cognitoDomain: { domainPrefix: `doorbell-${cdk.Aws.ACCOUNT_ID}` },
      });

      const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
        this, 'GoogleProvider', {
          userPool,
          clientId: props.googleClientId,
          clientSecretValue: cdk.SecretValue.unsafePlainText(props.googleClientSecret),
          scopes: ['email', 'profile', 'openid'],
          attributeMapping: {
            email: cognito.ProviderAttribute.GOOGLE_EMAIL,
            givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
            familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          },
        }
      );

      const adminCallbackUrl = `${siteUrl}/admin`;

      const userPoolClient = userPool.addClient('AdminClient', {
        oAuth: {
          flows: { authorizationCodeGrant: true },
          callbackUrls: [adminCallbackUrl],
          logoutUrls: [adminCallbackUrl],
          scopes: [
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.PROFILE,
          ],
        },
        supportedIdentityProviders: [
          cognito.UserPoolClientIdentityProvider.GOOGLE,
        ],
      });
      userPoolClient.node.addDependency(googleProvider);

      const adminFn = new lambda.Function(this, 'AdminFunction', {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'admin_handler.handler',
        code: lambda.Code.fromAsset('lambda'),
        environment: {
          CONFIG_BUCKET: siteBucket.bucketName,
          CONFIG_KEY: 'config.json',
        },
        timeout: cdk.Duration.seconds(10),
      });
      siteBucket.grantReadWrite(adminFn, 'config.json');

      const jwtAuthorizer = new authorizers.HttpUserPoolAuthorizer(
        'AdminAuthorizer',
        userPool,
        { userPoolClients: [userPoolClient] }
      );

      const adminIntegration = new integrations.HttpLambdaIntegration(
        'AdminLambdaIntegration',
        adminFn
      );

      httpApi.addRoutes({
        path: '/admin/config',
        methods: [apigw.HttpMethod.GET, apigw.HttpMethod.PUT],
        integration: adminIntegration,
        authorizer: jwtAuthorizer,
      });

      const cognitoDomainName = `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
      runtimeConfig.cognitoDomain = cognitoDomainName;
      runtimeConfig.cognitoClientId = userPoolClient.userPoolClientId;
      runtimeConfig.adminRedirectUri = adminCallbackUrl;

      if (props.adminEmails && props.adminEmails.length > 0) {
        new s3deploy.BucketDeployment(this, 'DeployAllowlist', {
          sources: [
            s3deploy.Source.jsonData('admin-allowlist.json', props.adminEmails),
          ],
          destinationBucket: siteBucket,
          prune: false,
        });
      }

      new cdk.CfnOutput(this, 'AdminPanelURL', {
        value: adminCallbackUrl,
        description: 'Admin panel URL for organizers',
      });

      new cdk.CfnOutput(this, 'AllowlistCommand', {
        value: `echo '["email@example.com"]' | aws s3 cp - s3://${siteBucket.bucketName}/admin-allowlist.json`,
        description: 'Update the admin allowlist (no redeploy needed)',
      });
    }

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset('./frontend'),
        s3deploy.Source.jsonData('runtime-config.json', runtimeConfig),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: false,
    });

    new cdk.CfnOutput(this, 'DoorbellURL', {
      value: siteUrl,
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
