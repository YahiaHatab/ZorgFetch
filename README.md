# ZORG-Ω Network Spy 🕵️‍♂️⚡

**ZORG-Ω Network Spy** is a highly specialized Chrome Extension built to automate the extraction of API credentials, authentication tokens, hidden session IDs, and fully formulated cURL commands from event and trade show directory platforms. 

Instead of manually digging through Chrome DevTools to reverse-engineer API requests, this extension uses the `chrome.debugger` API to silently intercept network traffic and isolate the exact parameters required for the ZORG web scraping framework.

## 🎯 Supported Platforms & Extraction Targets

The spy is currently calibrated with precise heuristics to extract data from the following 8 platforms:

1. **Cadmium (Conference Harvester)**
   * **Extracts:** `EventID`, `ClientID`, and `EventKey` 
   * **Method:** Intercepted from `CreateRentedBoothList.asp` POST payloads.
2. **eShow / goeshow**
   * **Extracts:** The precise authorization `Token` and the full execution `cURL`.
   * **Method:** Scans for standard and non-standard authorization headers (including tokens formatted as URL paths).
3. **Algolia (Directories)**
   * **Extracts:** `App ID`, `API Key`, and the full search `cURL` command.
   * **Method:** Parsed directly from query strings on `.algolia.net` index requests.
4. **Smartere (e.g., Intersolar)**
   * **Extracts:** `MenuPageID`, `X-CSRF-Token`, `Cookie` session data, and the execution `cURL`.
   * **Method:** Pulls IDs from the JSON POST payload and session/auth data from the request headers.
5. **a2zinc**
   * **Extracts:** The JSONP API `cURL` command and the embedded SmallWorld redirect URL (`strBoothClickURL`).
   * **Method:** Uses the debugger to fetch the raw HTML response body of `Eventmap.aspx` to extract the redirect variable.
6. **Map-Dynamics (Marketplace)**
   * **Extracts:** `Show ID` and active `PHPSESSID` cookies.
   * **Method:** Intercepts the `profile.marketplace.php` POST payloads and scans active browser cookies.
7. **Informa Markets (rxglobal)**
   * **Extracts:** The fully authenticated API `cURL` command.
   * **Method:** Filters for API endpoints containing valid authorization headers.
8. **Las Vegas Market**
   * **Extracts:** The dynamic `x-api-key`.
   * **Method:** Scans specific `/imc-api/` endpoint headers (falls back to known static keys if needed).

## 🛠️ Installation

Since this is an internal tool that requires elevated debugging permissions, it must be installed as an "Unpacked Extension" in Chrome:

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** using the toggle switch in the top right corner.
4. Click the **"Load unpacked"** button in the top left.
5. Select the folder containing the `manifest.json` file.
6. Pin the **ZORG-Ω** icon to your Chrome toolbar for easy access.

## 🚀 How to Use

1. **Navigate:** Go to the target exhibitor list, floor plan, or search directory.
2. **Enable:** Click the ZORG-Ω extension icon and click **Enable**. The spy is now attached to the tab and monitoring network traffic. *(Note: You will see a yellow banner at the top of Chrome saying "ZORG-Ω Network Spy started debugging this browser" — this is normal).*
3. **Trigger Traffic:** If required by the platform, perform an action to generate network traffic (e.g., type a letter in an Algolia search bar, or click an exhibitor on Map-Dynamics).
4. **Capture:** Click the **Capture** button. The extension will parse the intercepted requests, run its scoring heuristics, and display the extracted credentials.
5. **Copy:** Click the **Copy** buttons to instantly copy the tokens or cURL commands to your clipboard for use in your scraping scripts.
6. **Disable:** Click **Disable** to detach the debugger and clear the intercepted request cache.

## 🧩 Technical Architecture

* **Manifest V3:** Fully compliant with modern Chrome extension standards.
* **`background.js` (Service Worker):** Handles the `chrome.debugger` connection, caches network events (`Network.requestWillBeSent`, `Network.responseReceived`), and runs the scoring logic to find the highest-value API requests.
* **`popup.js` / `popup.html`:** Provides the cyberpunk-themed UI, handles platform auto-detection via regex, and manages clipboard interactions.

## ⚠️ Permissions

* `debugger`: Required to intercept raw network payloads, headers, and response bodies that standard web-request APIs cannot access.
* `activeTab`: Limits the debugger attachment only to the tab you are actively working in.
* `cookies`: Required to extract specific session tokens like `PHPSESSID`.

---

## 📜 Changelog

### v1.1.0 (Latest)
* **Added:** Support for **Smartere** platforms (e.g., Intersolar). Extracts `MenuPageID` from POST payloads, alongside `X-CSRF-Token` and `Cookie` headers.
* **Fixed:** **Map-Dynamics** extraction logic updated to intercept `Show_ID` from `profile.marketplace.php` POST form data instead of relying solely on URL parameters.
* **Fixed:** **eShow** extraction logic broadened to catch non-standard authorization headers (e.g., Bearer tokens formatted as URL paths) and updated to output the fully formulated cURL command.
* **Fixed:** **Cadmium** heuristic updated to extract `EventKey`, `EventID`, and `EventClientID` directly from the `CreateRentedBoothList.asp` form-data POST payload.
* **Fixed:** **Algolia** logic updated to parse `App ID` and `API Key` directly from the URL query parameters.
* **Fixed:** **a2zinc** extraction logic overhauled to asynchronously fetch the raw HTML response body of `Eventmap.aspx` to reliably extract the `strBoothClickURL` variable.