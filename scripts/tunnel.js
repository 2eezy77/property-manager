/**
 * Local tunnel — replaced by Railway deployment.
 *
 * For Stripe webhooks locally:
 *   stripe listen --live --forward-to http://localhost:8080/webhooks/stripe
 *
 * For a general HTTPS tunnel (e.g. Rocket Lawyer webhooks):
 *   npx cloudflared tunnel --url http://localhost:8080
 */
console.log('Use: stripe listen --live --forward-to http://localhost:8080/webhooks/stripe');
console.log('Or:  npx cloudflared tunnel --url http://localhost:8080');
