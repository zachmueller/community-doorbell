# Community Doorbell

A minimal serverless "doorbell" web app packaged as an AWS CDK project. Community event attendees visit a URL, tap a button, and organizers receive an SMS.

## Architecture

```
[S3 Static Site]  ->  [API Gateway]  ->  [Lambda]  ->  [SNS]  ->  SMS/Email
   index.html         POST /ring       Python    \    subscriber phones
   (CloudFront)       GET /status                 `-> [ntfy.sh] -> Push notifications
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

   # With push notifications via ntfy.sh
   cdk deploy -c email='you@example.com' -c ntfy='my-secret-doorbell-topic'
   ```
4. If using email: confirm the subscription via the link AWS sends to each address
5. Share the output URL with your community members

### Multiple recipients

Pass comma-separated lists:

```bash
cdk deploy -c phone='+15551111111,+15552222222' -c email='a@example.com,b@example.com'
```

## Push Notifications (ntfy.sh)

For instant push notifications on your phone and laptop, deploy with `-c ntfy='topic-name'`. This uses [ntfy.sh](https://ntfy.sh)'s free hosted tier (250 messages/day, no account required).

**How topic names work:** ntfy.sh has no accounts or registration. Topics are created automatically the first time anyone publishes or subscribes. The topic name acts as a shared secret — anyone who knows it can read your notifications. Use something long and random (e.g. `doorbell-a7f3x9k2m`) rather than a guessable word. See the [ntfy docs](https://docs.ntfy.sh/publish/) for full details.

**Subscribing on your devices:**

1. **Android**: Install the [ntfy app](https://play.google.com/store/apps/details?id=io.heckel.ntfy), tap **+**, and enter your topic name
2. **macOS**: Open `https://ntfy.sh/your-topic-name` in a browser and allow notifications, or install the [ntfy macOS app](https://github.com/niccokunzmann/ntfy-macos)

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

## Admin Panel (Optional)

Let other organizers set event times via a web UI with Google login. You control who has access through an email allowlist.

### Step 1: Create a Google OAuth Client ID

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth client ID**
5. If prompted, configure the **OAuth consent screen** first:
   - User type: **External**
   - App name: anything (e.g. "Community Doorbell Admin")
   - Support email: your email
   - Authorized domains: leave blank for now
   - Scopes: add `email`, `profile`, `openid`
   - Test users: add the Google emails of your organizers (required while in "Testing" status)
6. Back on the Credentials page, click **Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: anything (e.g. "Doorbell Cognito")
   - Authorized redirect URIs: add your Cognito callback URL (see below)
7. Copy the **Client ID** and **Client Secret**

### Step 2: Determine Your Cognito Redirect URI

The Cognito domain is predictable — it uses your AWS account ID:

```
https://doorbell-<ACCOUNT_ID>.auth.<REGION>.amazoncognito.com/oauth2/idpresponse
```

For example, if your account is `123456789012` and you deploy to `us-east-1`:

```
https://doorbell-123456789012.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

You can find your account ID with `aws sts get-caller-identity --query Account --output text`.

Enter this URI as the **Authorized redirect URI** in the Google Cloud Console (Step 1.6 above).

### Step 3: Deploy with Admin Parameters

```bash
cdk deploy \
  -c phone='+15551234567' \
  -c googleClientId='YOUR_GOOGLE_CLIENT_ID' \
  -c googleClientSecret='YOUR_GOOGLE_CLIENT_SECRET' \
  -c adminEmails='organizer1@gmail.com,organizer2@gmail.com'
```

The `adminEmails` list seeds the initial allowlist. After deployment, the admin panel URL is printed as a stack output.

### Managing the Allowlist

Add or remove organizers at any time without redeploying:

```bash
echo '["organizer1@gmail.com","organizer2@gmail.com","new-person@gmail.com"]' \
  | aws s3 cp - s3://BUCKET_NAME/admin-allowlist.json
```

The bucket name is shown in the stack outputs after deploy.

### How It Works

Organizers visit `/admin.html`, click "Login with Google", and authenticate through the Cognito hosted UI. The pre-signup trigger checks their email against `admin-allowlist.json` in S3 — if they're not on the list, signup is denied. Once authenticated, they can toggle the doorbell active/inactive and set start/end times through a simple form.

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
