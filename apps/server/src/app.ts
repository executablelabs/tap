import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { handoffPage, landingPage } from "./pages";
import { createSponsorService } from "./sponsor/service";
import { styles } from "./styles";

export const apkDownloadUrl =
  "https://github.com/gitaugakwa/tap/releases/latest/download/tap-android.apk";

const androidAssetLinks = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "xyz.tap.demo",
      sha256_cert_fingerprints: [
        "AA:3C:40:C8:E1:E1:C3:56:EC:62:D6:C5:68:93:0C:DA:ED:8F:BA:4F:69:97:D8:4B:25:3F:5C:AA:6F:F8:07:24",
      ],
    },
  },
];

const app = new Hono();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      baseUri: ["'self'"],
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'self'"],
    },
  }),
);

app.get("/health", (context) => context.json({ status: "ok" }));
// No credentials, environment enablement, database or live gateway is attached.
app.route("/api/sponsor", createSponsorService());
app.get("/.well-known/assetlinks.json", (context) => {
  context.header("cache-control", "public, max-age=3600");
  return context.json(androidAssetLinks);
});
app.get("/styles.css", (context) =>
  context.body(styles, 200, {
    "cache-control": "public, max-age=3600",
    "content-type": "text/css; charset=UTF-8",
  }),
);

app.get("/", (context) => context.html(landingPage(apkDownloadUrl)));
app.get("/p", (context) => context.html(handoffPage(apkDownloadUrl)));

app.notFound((context) => context.text("Not found", 404));

export { app };
