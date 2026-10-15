# Retry Failed Settlement

This runbook explains how to handle and retry failed settlement batches.

## Overview

When an order is captured, the system creates a settlement batch and attempts to payout funds to merchants via PayPal. Occasionally, PayPal batch processing fails due to:

- Temporary API outages
- Invalid merchant account details
- Rate limiting
- Network issues

The system can retry these failed batches.

## Identifying Failed Settlements

### Via API

```bash
# List all settlement batches with status
curl "http://localhost:4000/settlements?status=FAILED" \
  -H "Authorization: Bearer <auth-token>"
```

Response:
```json
{
  "status": "success",
  "settlements": [
    {
      "id": "batch-uuid",
      "orderId": "order-uuid",
      "status": "FAILED",
      "errorMessage": "Merchant account not verified",
      "createdAt": "2026-10-14T12:00:00Z"
    }
  ]
}
```

### Via Database

```sql
SELECT id, order_id, status, error_message, created_at
FROM payout_batch
WHERE status = 'FAILED'
ORDER BY created_at DESC;
```

### Via Logs

```bash
# Check application logs for settlement errors
tail -f /var/log/tabhop/api.log | grep "settlement"
```

## Diagnose the Failure

Before retrying, understand why the settlement failed:

```sql
SELECT 
  pb.id,
  pb.paypal_batch_id,
  pb.status,
  pb.error_message,
  o.id as order_id,
  o.total_amount,
  m.name as merchant_name
FROM payout_batch pb
JOIN "order" o ON pb.order_id = o.id
LEFT JOIN merchant m ON pb.merchant_id = m.id
WHERE pb.status = 'FAILED'
AND pb.created_at > NOW() - INTERVAL '1 day';
```

**Common error messages:**

| Error | Cause | Solution |
|-------|-------|----------|
| "Merchant account not verified" | Merchant hasn't completed PayPal setup | Contact merchant to verify account |
| "Invalid recipient account" | Account details in database are wrong | Update merchant payment details |
| "Rate limit exceeded" | Too many requests to PayPal | Wait and retry automatically |
| "PayPal service temporarily unavailable" | PayPal outage | Wait 5-10 minutes and retry |

## Retry a Settlement

### Automatic Retry

The system automatically retries failed settlements after:
- 5 minutes (first retry)
- 30 minutes (second retry)
- 1 hour (third retry)
- Then daily for 7 days

No action needed.

### Manual Retry

For urgent cases, manually trigger a retry:

```bash
# Retry a specific settlement
curl -X POST "http://localhost:4000/settlements/{{orderId}}/retry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-token>"
```

Response:
```json
{
  "status": "success",
  "message": "Settlement retry initiated",
  "payoutBatchId": "new-batch-id"
}
```

### Bulk Retry (Development)

For testing, reset all failed settlements in the database:

```sql
UPDATE payout_batch
SET status = 'PENDING',
    error_message = NULL,
    retry_count = 0
WHERE status = 'FAILED'
AND created_at > NOW() - INTERVAL '24 hours';
```

Then trigger the settlement job.

## Verify Retry Success

After retrying, check the status:

```bash
curl "http://localhost:4000/orders/{{orderId}}" \
  -H "Authorization: Bearer <auth-token>"
```

Response should show:
```json
{
  "order": {
    "status": "SETTLED",
    "payoutBatch": {
      "status": "SUCCESS"
    }
  }
}
```

## Escalation

If a settlement continues to fail after multiple retries:

1. **Check merchant account status**:
   - Log in to PayPal as the merchant
   - Verify account is in good standing
   - Ensure bank account is linked and verified

2. **Update payment details**:
   ```bash
   # Update merchant payout email in database
   UPDATE merchant
   SET payout_email = 'new-email@example.com'
   WHERE id = '{{merchantId}}';
   ```

3. **Contact PayPal Support**:
   - Provide PayPal batch ID (from database)
   - Ask about account restrictions or issues

4. **Manual Payout**:
   - As last resort, manually create a payout via PayPal dashboard
   - Update database to mark batch as MANUALLY_PAID
   - Document the manual payout reference

## Prevention

To prevent future settlement failures:

1. **Verify merchant accounts** before settling
2. **Keep payment details current** - ask merchants during onboarding
3. **Monitor PayPal status** - watch their status page
4. **Set up alerts** - alert on_failed settlement batches
