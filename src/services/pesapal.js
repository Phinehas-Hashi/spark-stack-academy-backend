const SANDBOX_BASE = "https://cybqa.pesapal.com/pesapalv3";
const LIVE_BASE = "https://pay.pesapal.com/v3";

function baseUrl() {
  return process.env.PESAPAL_ENV === "production" ? LIVE_BASE : SANDBOX_BASE;
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || "Pesapal request failed.";
    throw new Error(message);
  }
  return data;
}

export async function getPesapalToken() {
  if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
    throw new Error("Pesapal credentials are not configured.");
  }

  const response = await fetch(`${baseUrl()}/api/Auth/RequestToken`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    })
  });

  const data = await parseResponse(response);
  if (!data.token) throw new Error("Pesapal did not return an access token.");
  return data.token;
}

export async function submitPesapalOrder(order) {
  const token = await getPesapalToken();

  const response = await fetch(`${baseUrl()}/api/Transactions/SubmitOrderRequest`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(order)
  });

  return parseResponse(response);
}

export async function getPesapalTransactionStatus(orderTrackingId) {
  const token = await getPesapalToken();

  const response = await fetch(
    `${baseUrl()}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    }
  );

  return parseResponse(response);
}
