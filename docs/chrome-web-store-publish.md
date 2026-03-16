# Chrome Web Store Publish Notes

## Ready artifacts

- Upload ZIP: `release/smart-translator-chrome-web-store.zip`
- Build output: `dist/`
- Promo tile upload folder: `release/webstore-assets/`
- One-command pack script: `npm run package:chrome`
- Recommended promo files:
  - `release/webstore-assets/small-promo-tile-440x280.jpg`
  - `release/webstore-assets/top-promo-tile-1400x560.jpg`

## Pre-flight status

- Manifest V3: yes
- Production build: passed
- Icons in package: yes
- Background logic bundled locally: yes
- Remote hosted code detected: no

## Permission justification copy

Use the following Chinese copy if you keep the current manifest as-is in the Chrome Web Store dashboard:

- `activeTab`

  该权限用于在用户主动触发扩展功能时访问当前活动标签页，并将翻译指令发送到当前页面。用户可以通过工具栏弹窗、快捷键或右键菜单触发翻译。扩展仅在用户操作后对当前标签页执行选中文本翻译、输入框翻译或整页翻译，不会在后台自动读取所有标签页内容。

- `storage`

  该权限用于保存用户的翻译设置和本地数据，包括源语言/目标语言、默认翻译引擎、用户填写的 API Key、主题、快捷键、静默翻译模式，以及本地翻译历史和缓存。保存这些数据是为了让用户的配置在浏览器中持续生效，并提升重复翻译时的响应速度。

- `contextMenus`

  该权限用于在浏览器右键菜单中提供“翻译选中文本”“翻译整页”以及“切换静默翻译模式”等操作项。用户通过右键菜单触发后，扩展才会对当前页面或当前选中文本执行翻译。

- `scripting`

  该权限用于在用户请求翻译时将页面翻译相关逻辑应用到当前网页，以支持选中文本翻译、输入框翻译和整页翻译等页面内交互。扩展不会注入远程代码，相关逻辑均随扩展安装包一同发布。

- `host permissions`

  扩展需要在用户访问的网页中运行内容脚本，才能提供选中文本翻译、输入框原位翻译、整页翻译、悬浮翻译按钮和快捷键翻译等功能。由于用户可能在任意网站上使用这些功能，因此扩展申请对网页的主机权限。扩展只会在用户主动触发翻译时处理页面中的文本内容，并将待翻译文本发送到用户自行选择并配置的翻译服务提供商。

- `Remote code`

  请选择“`不，我并未使用远程代码`”。

  可补充说明：

  扩展的所有 JavaScript 逻辑均打包在扩展安装包内，未通过远程 `script`、远程 Wasm、`eval()` 或下载后执行代码的方式加载或运行外部代码。扩展仅在用户触发翻译时通过网络请求访问用户所选择的翻译 API，以获取翻译结果。

## Data usage checklist

Recommended answers for the Chrome Web Store "Data usage" section, based on the current code and privacy policy:

- 勾选 `身份验证信息`

  原因：扩展会保存用户填写的第三方翻译服务 API Key，以及部分提供商配置，例如 region、endpoint、model 和 system prompt。API Key 属于认证信息。

- 勾选 `网站内容`

  原因：扩展支持翻译网页选中文本、输入框文本和整页文本，会处理用户当前页面中被用户主动选择翻译的网页内容。

- 建议勾选 `个人通讯`

  原因：如果用户在邮箱、聊天、工单、评论区等页面中主动选择文本或执行整页翻译，扩展可能会处理个人通讯内容。该数据不是自动收集，而是仅在用户主动触发翻译时处理。

- 可保守勾选 `个人身份信息`

  原因：若用户主动翻译的文本中包含姓名、邮箱地址、电话、账号等内容，扩展会随翻译请求处理这些信息。若你希望公开披露更保守、降低审核争议，可以勾选这一项；若你希望按“仅披露产品明确收集的类别”填写，也可以不勾选，并在隐私政策中保留“仅当用户主动提交此类文本时才会处理”的说明。

- 不勾选 `健康信息`

  原因：当前产品没有专门收集或分析健康数据的功能。

- 不勾选 `财务和付款信息`

  原因：当前产品不会专门收集银行卡、支付记录、信用信息等财务或付款数据。

- 不勾选 `位置`

  原因：当前产品不会读取设备定位，也不会专门收集地理位置数据。

- 不勾选 `网络记录`

  原因：当前产品不会记录用户访问过的网站列表、页面标题或访问时间，也不以浏览历史为功能输入。

- 不勾选 `用户活动`

  原因：虽然扩展会监听鼠标移动和按键事件以实现悬浮翻译按钮、快捷键和段落定位，但这些事件不会作为用户活动日志持久化保存，也不会上传给开发者。

Recommended practical combination:

- 最稳妥、偏保守：`身份验证信息`、`网站内容`、`个人通讯`、`个人身份信息`
- 相对克制、但仍合理：`身份验证信息`、`网站内容`、`个人通讯`

For the certification checkboxes below, select all of them:

- `我不会出于已获批准的用途之外的用途向第三方出售或传输用户数据`
- `我不会为实现与我的产品的单一用途无关的目的而使用或转移用户数据`
- `我不会为确定信用度或实现贷款而使用或转移用户数据`

## Review recommendation

- Current code audit did not find any `chrome.scripting` API call.
- Current code audit also did not find a clear runtime dependency on `activeTab`.
- If you remove `activeTab` and `scripting` from `manifest.json`, you can reduce review friction and shorten the permission justification section.

## Review-sensitive areas in this project

- The extension declares `<all_urls>` in `host_permissions`.
- The extension injects content scripts on all pages.
- The extension can send selected text, input text, or page text to third-party translation APIs, but only after the user triggers a translation action.
- Provider API keys are stored in Chrome extension storage so the chosen provider can be called on the user's behalf.

These behaviors are aligned with the product's user-facing purpose, but they must be described clearly in the store listing and privacy fields.

## Suggested single purpose

Translate user-selected text, focused input fields, and full web pages on demand using the translation provider chosen by the user.

## Suggested short description

Translate selections, inputs, and full web pages with your own API keys and provider choice.

## Suggested detailed description

Smart Translator is a Chrome extension for on-demand translation across the web.

Core features:

- Translate selected text directly on the page
- Translate the focused input or textarea in place
- Translate an entire page and restore the original text anytime
- Use popup quick translation for ad hoc text
- Switch between standard translation APIs and AI providers
- Bring your own API key and choose the provider you trust
- Keep recent history and translation cache on device

How data is used:

- Text is sent to the provider you selected only when you trigger a translation action.
- Provider credentials are stored in Chrome extension storage so requests can be made from the extension.
- Translation history and cache are stored locally in the browser.
- The extension does not sell user data and does not use data for advertising.

## Privacy tab guidance

Answer these fields based on the current code behavior:

- Personal communications: only if the user pastes or selects them for translation
- Website content: yes
- User activity: no browsing history collection beyond the text the user explicitly translates
- Authentication information: yes, provider API keys entered by the user
- Location: no
- Financial information: no
- Health information: no
- Personally identifiable information: only if the user includes it in text submitted for translation

Typical declarations:

- Data is used to provide translation features requested by the user
- Data is not sold
- Data is not used for creditworthiness
- Data is not used for personalized ads
- Data is not used for unrelated purposes

## Assets still needed in the dashboard

- At least one `1280x800` screenshot
- Small promo tile `440x280`
- Optional marquee promo tile `1400x560`
- Public privacy policy URL
- Support URL

## Recommended publish flow

1. Run `npm run package:chrome`.
2. Register the developer account and enable 2-Step Verification.
3. Upload `release/smart-translator-chrome-web-store.zip`.
4. Fill in the single purpose field with the text above.
5. Complete the listing with screenshots and promo tile.
6. Add a public privacy policy URL that matches actual extension behavior.
7. Double-check that the privacy tab answers match the code and the privacy policy.
8. Submit for review.
