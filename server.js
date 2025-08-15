import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch tracking information from FedEx for a given tracking number.
 * Uses the same API that the public FedEx tracking page calls.
 *
 * @param {string} trackingNumber - FedEx tracking number
 */
async function fetchFedEx(trackingNumber) {
  const url = "https://www.fedex.com/trackingCal/track";
  const payload = {
    TrackPackagesRequest: {
      appType: "wtrk",
      uniqueKey: "",
      processingParameters: {
        anonymousTransaction: true,
        clientId: "WTRK",
        returnDetailedErrors: true,
        returnLocalizedDateTime: true,
      },
      trackingInfoList: [
        {
          trackNumberInfo: {
            trackingNumber,
            trackingQualifier: "",
            trackingCarrier: "",
          },
        },
      ],
    },
  };

  const form = new URLSearchParams();
  form.append("data", JSON.stringify(payload));
  form.append("action", "trackpackages");
  form.append("locale", "es_MX");
  form.append("format", "json");
  form.append("version", "1");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: "https://www.fedex.com",
      Referer: "https://www.fedex.com/fedextrack/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36",
    },
    body: form,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const pkg = data?.TrackPackagesResponse?.packageList?.[0];
  if (!pkg) throw new Error("Sin datos del paquete");
  const events = Array.isArray(pkg.scanEventList) ? pkg.scanEventList : [];
  const last = events[0] || null;
  const status =
    (last && last.status) ||
    pkg.keyStatus ||
    pkg.localization?.message ||
    "Sin información";
  const lastWhen =
    (last && `${last.date} ${last.time}`) ||
    pkg.displayActDeliveryDt ||
    pkg.displayEstDeliveryDt ||
    "";
  const location =
    (last && last.scanLocation) ||
    [
      pkg.scanLocationCity,
      pkg.scanLocationStateOrProvinceCode,
      pkg.scanLocationCountryCode,
    ]
      .filter(Boolean)
      .join(", ") ||
    "";
  return {
    trackingNumber,
    lastStatus: status,
    lastUpdateLocal: lastWhen,
    location,
    delivered: Boolean(pkg.isDelivered),
    service: pkg.serviceTypeDesc || pkg.serviceCommitMessage || "",
  };
}

app.post("/api/track", async (req, res) => {
  try {
    const raw = Array.isArray(req.body.numbers) ? req.body.numbers : [];
    const numbers = [
      ...new Set(
        raw
          .map((x) => String(x).trim())
          .filter(Boolean)
      ),
    ];
    const results = [];
    for (const n of numbers) {
      try {
        const r = await fetchFedEx(n);
        results.push({ ok: true, ...r });
      } catch (e) {
        results.push({ ok: false, trackingNumber: n, error: String(e.message || e) });
      }
      await sleep(800); // delay between calls to avoid rate limits
    }
    res.json({ count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server listo en http://localhost:${PORT}`);
});