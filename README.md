# Community Doorbell

A minimal serverless "doorbell" web app packaged as an AWS CDK project. Community event attendees visit a URL, tap a button, and organizers receive an SMS.

## Architecture

```
[S3 Static Site]  ->  [API Gateway]  ->  [Lambda]  ->  [SNS]  ->  SMS
   index.html         POST /ring       Python        subscriber phones
   (CloudFront)       GET /status
```

## Quick Start

1. Clone this repo
2. Install dependencies:
   ```bash
   npm install
   ```
3. Deploy with your notification preferences:
   ```bash
   # Email only
   cdk deploy -c email='you@example.com'

   # Phone only
   cdk deploy -c phone='+15551234567'

   # Both
   cdk deploy -c phone='+15551234567' -c email='you@example.com'
   ```
4. If using email: confirm the subscription via the link AWS sends to each address
5. Share the output URL with your community members

### Multiple recipients

Pass comma-separated lists:

```bash
cdk deploy -c phone='+15551111111,+15552222222' -c email='a@example.com,b@example.com'
```

## SMS Sandbox Note

New AWS accounts have SMS in sandbox mode, which only allows sending to verified phone numbers. If SMS isn't working, either verify destination numbers via the CLI or request production access. Email subscriptions work immediately (after confirming the subscription link).

## Toggle the Doorbell

Activate before an event:

```bash
echo '{"active":true,"message":"Someone is at the door!"}' | aws s3 cp - s3://BUCKET_NAME/config.json
```

Deactivate after:

```bash
echo '{"active":false}' | aws s3 cp - s3://BUCKET_NAME/config.json
```

### Scheduled activation

You can set a time window so the doorbell auto-activates and deactivates:

```bash
echo '{"active":true,"message":"Someone is at the door!","start":"2026-05-17T16:00:00+12:00","end":"2026-05-17T20:00:00+12:00"}' | aws s3 cp - s3://BUCKET_NAME/config.json
```

The doorbell will only respond to rings between `start` and `end`. Times are ISO 8601 with timezone offset. If omitted, the doorbell is active whenever `active` is `true`.

The S3 bucket name and a ready-to-use toggle command are printed as stack outputs after deploy.

## Tear Down

```bash
cdk destroy
```

## How It Works

- **Frontend**: Static HTML hosted on S3 behind CloudFront (HTTPS)
- **API**: HTTP API Gateway with rate limiting (1 req/sec, burst 5)
- **Lambda**: Python function that checks activation config and publishes to SNS
- **Config**: JSON file in S3 controls whether the doorbell is active
- **Notifications**: SNS topic with SMS subscriptions for organizer phone numbers
