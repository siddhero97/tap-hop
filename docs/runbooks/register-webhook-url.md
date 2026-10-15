# Register PayPal Webhook URL

This runbook explains how to register your webhook URL with PayPal so that events (like successful payments) are sent to your application.

## Overview

PayPal sends webhook events to your application whenever:
- A payment is captured
- A payout succeeds or fails
- A subscription is created/canceled
- etc.

Your endpoint must:
1. Be publicly accessible (HTTPS, not localhost)
2. Verify webhook signatures from PayPal
3. Process events and return 200 OK
4. Handle duplicate events idempotently

## Prerequisites

- PayPal sandbox credentials (see [paypal-sandbox-setup.md](./paypal-sandbox-setup.md))
- TabHop running and accessible at a public URL
- Either:
  - Cloud deployment with HTTPS URL
  - Local tunnel (ngrok) for testing

## Local Testing with ngrok

1. **Install ngrok**: https://ngrok.com
2. **Start ngrok tunnel**:
   ```bash
   ngrok http 4000
   ```
   This generates a URL like `https://abc123.ngrok.io`

3. Your webhook URL becomes: `https://abc123.ngrok.io/webhooks/paypal`

## Register Webhook in PayPal Console

1. Go to https://developer.paypal.com
2. Navigate to "Apps & Credentials" → "Sandbox"
3. Under your app, click on the app name to see details
4. Scroll to "Sandbox signature" section
5. Click "Add Signature"

### Configure Webhook Events

6. **Webhook URL**: Enter your public URL
   ```
   https://api.tabhop.com/webhooks/paypal
   (or your ngrok URL for testing)
   ```

7. **Events to subscribe to**: Select at minimum:
   - `CHECKOUT.ORDER.COMPLETED` - Payment captured
   - `PAYMENT.CAPTURE.COMPLETED` - Refund events
   - Optionally add more as needed

8. Click "Save"

9. **Copy the Webhook ID**: This is shown after saving
   - Save this in your `.env`: `PAYPAL_WEBHOOK_ID=<webhook-id>`

## Verify Webhook Registration

1. **Trigger a test event** via PayPal console:
   - Click on your webhook in the console
   - Click "Send Test Event"
   - Select an event type
   - Click "Send"

2. **Check your application logs**:
   ```bash
   # You should see:
   # "Webhook received from PayPal: CHECKOUT.ORDER.COMPLETED"
   # "Signature verified"
   ```

3. **Verify your application processed it**:
   - Check database for created/updated records
   - Check settlement ledger

## Troubleshooting

### Webhook not being called
- Verify URL is publicly accessible: `curl https://your-url/webhooks/paypal` should return 405 (method not allowed)
- Check PayPal console webhook logs for delivery attempts
- Verify firewall/security groups allow HTTPS traffic

### "Invalid signature" errors
- Ensure `PAYPAL_WEBHOOK_ID` matches the webhook registered in PayPal
- Check webhook signing logic in `src/webhooks/webhooks.controller.ts`
- Regenerate webhook if credentials were leaked

### Duplicate events
- Application should handle duplicate webhook IDs idempotently
- Use database uniqueness constraints on `webhookId` if available

## Production Deployment

1. Deploy your application to production (e.g., Render)
2. Register your production webhook URL with PayPal **Production** credentials
3. Never use ngrok or test URLs in production
4. Keep webhook URL and ID secure (don't commit to version control)
