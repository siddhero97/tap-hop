# PayPal Sandbox Setup

This runbook walks through setting up PayPal sandbox credentials for testing.

## Prerequisites

- PayPal Business account
- Access to https://developer.paypal.com
- TabHop environment variables file ready to update

## Steps

### 1. Log in to PayPal Developer Console

1. Go to https://developer.paypal.com
2. Click "Log in to Dashboard"
3. Sign in with your PayPal Business account

### 2. Create Sandbox Application

1. In the left sidebar, click "Apps & Credentials"
2. Ensure you're on the "Sandbox" tab
3. Under "REST API apps", click "Create App"
4. Enter app name: "TabHop Sandbox"
5. Click "Create App"

### 3. Retrieve Credentials

1. Your app should now be listed under "REST API apps"
2. Click on "TabHop Sandbox" to expand details
3. Copy the **Client ID** and **Client Secret**
4. These are your `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`

### 4. Set Environment Variables

Update `.env` (or your deployment config):

```bash
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=<client-id-from-step-3>
PAYPAL_CLIENT_SECRET=<client-secret-from-step-3>
PAYPAL_WEBHOOK_ID=<will-be-set-in-next-section>
```

### 5. Register Webhook Endpoint

See [register-webhook-url.md](./register-webhook-url.md) for detailed webhook setup.

## Verification

1. Start the dev server: `pnpm dev`
2. Create an order via Postman or API client
3. Attempt to create a PayPal order - should not return errors
4. Check logs for PayPal API calls (should show successful responses)

## Troubleshooting

### "Invalid client ID" error
- Verify `PAYPAL_CLIENT_ID` is correctly copied from Developer Console
- Ensure `PAYPAL_MODE=sandbox` is set
- Credentials are case-sensitive

### "Unauthorized" error
- Check that `PAYPAL_CLIENT_SECRET` is correct
- Verify credentials are for sandbox, not production
- Regenerate credentials if unsure

### Webhook not receiving events
- See [register-webhook-url.md](./register-webhook-url.md)
- Verify webhook URL is publicly accessible and HTTPS
- Use ngrok or similar for local testing: `ngrok http 4000`

## Production Credentials

When deploying to production:

1. Go to "Apps & Credentials" → "Production" tab
2. Create a production app following the same steps
3. Use production credentials in your production `.env`
4. Never commit credentials to version control
