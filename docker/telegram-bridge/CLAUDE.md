# Telegram Bridge Service

A lightweight Node.js service that receives webhooks from Grafana and forwards them to Telegram Bot API. This allows using webhook notifiers in Grafana while still sending notifications to Telegram.

## Architecture

The service is split into modular components:

- **`index.js`** - Main entry point, loads configuration and starts server
- **`src/server.js`** - HTTP server with webhook and health endpoints  
- **`src/telegram.js`** - Telegram API communication
- **`src/secrets.js`** - Docker secrets loading utility
- **`src/message-utils.js`** - Message processing and emoji assignment

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)
- `TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN_FILE` - Bot token for Telegram API
- `TELEGRAM_CHAT_ID` or `TELEGRAM_CHAT_ID_FILE` - Target chat/group ID
- `DEBUG` - Enable debug logging (see Debug Logging section)

### Docker Secrets Pattern

The service supports both direct environment variables and Docker secrets:
- Direct: `TELEGRAM_BOT_TOKEN=your_token`
- File-based: `TELEGRAM_BOT_TOKEN_FILE=/run/secrets/telegram_bot_token`

File-based secrets take precedence over direct environment variables.

## API Endpoints

### POST /webhook
Receives webhook payloads and forwards them to Telegram.

**Supported Formats:**
- Grafana webhook format (recommended)
- Simple message object: `{"message": "text"}`
- Text field object: `{"text": "text"}`
- Raw string

A JSON object body may add `"safety": true` to ring during the quiet hours (see [Quiet hours](#quiet-hours)).

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed and sent to Telegram",
  "telegramResponse": { ... }
}
```

### GET /health
Health check endpoint returns service status.

**Response:**
```json
{
  "status": "healthy",
  "service": "telegram-bridge", 
  "timestamp": "2023-..."
}
```

## Quiet hours

From **23:00 to 07:00** on the `Europe/Sofia` wall clock, the bridge sends every message with
Telegram's `disable_notification`, so it arrives without sound. Nothing is dropped or delayed.
Safety messages still ring (issue #1744). The window follows the local clock across the clock changes.

**Limit:** `disable_notification` only removes the sound of one message. Telegram has no alert that
rings through a muted chat or the phone's Do Not Disturb. For a safety message to ring, the chat must
not be muted on the phone, and Do Not Disturb must allow Telegram. A real wake-up channel is a
separate question.

A message is a **safety message** when:
- any alert in a Grafana webhook has the label `safety: "true"` (firing or resolved), or
- a JSON object body has `"safety": true` (for direct senders).

**At night, a safety alert rings once** (issue #1745). The bridge remembers each safety alert it has
sent, by its Grafana `fingerprint` and `startsAt` (the firing episode), day or night. A repeat of
the same episode at night is silent. A new firing (new `startsAt`) and a resolved message ring. A
direct `"safety": true` message always rings. The memory is lost when the bridge restarts, so the
first repeat after a restart rings once.

The safety label is set on these rules in `config/grafana/provisioning/alerting/`:

| Kind | Rules |
|---|---|
| Power outage | Total Power Outage, Phase Power Loss |
| Boiler | Boiler Overheating Critical (85 °C; the tank has no mixing valve, so it is a scald risk) |
| Heat pump | Термопомпа опасност от замръзване (freeze danger) |
| Car tyres | Ioniq Tyre Low, Critical, Over-inflated and Hot (each wheel), Tyre Pressure Spread High |
| Car HV battery | Ioniq HV Isolation Low and Critical, Pack Temperature Critical |

Everything else is silent at night, for example the dishwasher and washing machine reminders, the
mower, the other boiler alerts, Main Power (over 10 kW use), AC voltage, the other Ioniq alerts and
the `ioniq-dtc` bot. There is no UPS alert yet; a future UPS low-battery alert must carry the label.

**To change the list**, add or remove `safety: "true"` in the rule's `labels` and deploy (Grafana
reloads its provisioning on restart). Then update the table above. The window and the time zone are
constants in `src/quiet-hours.js`.

A DatasourceNoData or DatasourceError alert keeps the labels of its rule, so it rings for a labelled
rule. A Grafana "test contact point" message has no safety label, so it is silent at night unless
`safety=true` is added in the test dialog.

Grafana has no part in the timing. Grafana 9.5 cannot send a webhook silently, and a mute timing
would hold notifications back: a "done" alert that fires and clears inside the night would never be
sent.

## Message Processing

### Grafana Webhook Format

For Grafana webhooks, the service generates rich HTML messages with:
- Alert status and receiver info
- Individual alert details with appropriate emojis
- Special formatting for system alerts (DatasourceNoData, DatasourceError)
- Links to Grafana dashboards and panels
- Timestamp in Europe/Sofia timezone

**System Alert Formatting:**
The service provides distinct formatting for Grafana system alerts:

- **DatasourceNoData alerts** use 📵 emoji and "DATA SOURCE ISSUE" text
- **DatasourceError alerts** use 🚧 emoji and "ALERT SYSTEM ERROR" text  
- **Resolved system alerts** use ✅ emoji with "RECOVERED" status
- All system alerts highlight the affected alert rule name clearly
- System alerts use single, distinctive emojis separate from regular alerts

This helps distinguish between actual service issues and problems with the alert system itself.

### Emoji Assignment

**Alert Type Emojis** (based on alert names):
- 💧 Water/pump related (цисла, water, pump)
- 🔴 Signal alerts (сигла)
- 🌡️ Temperature/heat related (термопомпа, heat, temperature)
- ⚡ Power related (power)
- 🔌 AC/voltage related (ac, voltage)  
- 💨 Humidity related (humidity)
- 🍽️ Dishwasher related (миялна, dishwasher)
- ⚠️ Default for unknown alerts

**Alert Status Emojis**:
- 🚨 Firing/Critical/Alerting state
- ✅ Resolved/OK state  
- ⚠️ Warning state
- 📵 NoData state (data source issues)
- 🚧 Error state (alert system issues)
- ℹ️ Info/Unknown states

## Development

### Project Structure
```
docker/telegram-bridge/
├── .nvmrc                      # Node.js version specification
├── index.js                    # Main entry point
├── src/                        # Source code modules
│   ├── server.js              # HTTP server logic
│   ├── telegram.js            # Telegram API client
│   ├── secrets.js             # Configuration loading
│   ├── message-utils.js       # Message processing
│   ├── quiet-hours.js         # Silent delivery at night, safety messages
│   └── message-utils.test.js  # Unit tests for message utils
├── jest.config.js             # Jest configuration
├── package.json               # Dependencies and scripts
├── Dockerfile                 # Container definition
├── CLAUDE.md                  # Development documentation
└── __tests__/
    ├── setup.js               # MSW test setup
    └── telegram-bridge.test.js # Integration tests
```

### Testing

The service uses Jest with MSW (Mock Service Worker) for minimal mocking:

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

**Test Philosophy:**
- Minimal mocking - only mock external HTTP calls (Telegram API)
- Real HTTP server testing with actual request/response cycles
- Verification of actual payloads sent to external services
- Unit tests for utility functions with exported modules

### Adding New Alert Types

1. Update `getAlertEmoji()` in `src/message-utils.js`
2. Add test cases in `src/message-utils.test.js`
3. Verify with actual Grafana alert names from provisioning config

### Customizing System Alert Formatting

The system alert formatting logic is in `formatSystemAlert()` function:

1. **For different alert states**: Modify the `getStatusEmoji()` mapping
2. **For different system messages**: Update the status text in `formatSystemAlert()`
3. **For additional system alert types**: Extend the `isSystemAlert()` detection logic
4. **Always add comprehensive tests** for any new alert state handling

### Development Commands

```bash
# Install dependencies
npm install

# Start service for development
npm start

# Run linting (if configured)
npm run lint

# Run type checking (if configured)
npm run typecheck
```

## Integration

### Grafana Configuration

Configure webhook notifier in Grafana:
```yaml
notifiers:
  - name: telegram-webhook
    type: webhook  
    settings:
      url: http://telegram-bridge:3000/webhook
      httpMethod: POST
```

### Docker Compose Example

```yaml
telegram-bridge:
  build: ./docker/telegram-bridge
  ports:
    - "3000:3000"
  secrets:
    - telegram_bot_token
    - telegram_chat_id
  environment:
    TELEGRAM_BOT_TOKEN_FILE: /run/secrets/telegram_bot_token
    TELEGRAM_CHAT_ID_FILE: /run/secrets/telegram_chat_id
```

## Monitoring

### Health Checks

The `/health` endpoint can be used for:
- Docker health checks
- Load balancer health probes  
- Monitoring system checks

### Logging

The service provides structured console logging with emojis for visual parsing:
- 🏠 Service startup. It logs only that the bot token is loaded, and the chat id masked to its last 3 characters (#1765)
- 📥 Webhook received
- 📝 Message extracted
- 📤 Telegram API calls
- ✅ Success operations
- ❌ Error conditions

### Sent-message log

Every Bot API call writes one JSON line to stdout (`docker logs telegram-bridge`), for successes and failures, with the full text. The Bot API cannot list what a bot sent, so this is the only history:

```json
{"event":"telegram.sent","sender":"telegram-bridge","source":"grafana","origin_host":"routy","silent":false,"ok":true,"message_id":4711,"error":null,"text":"<full text as sent>"}
```

- `source` is what asked for the message: a `source` string in the JSON body, or a `?source=` query parameter; default `grafana`. The `ioniq-dtc` bot sends `source: "ioniq-dtc"`.
- `silent` is true when the message was sent without sound ([Quiet hours](#quiet-hours)).
- `error` is the Bot API `description`, or the transport error. No chat id, and the bot token is stripped from errors.
- Code: `src/sent-log.js`. Search: `docker logs telegram-bridge | grep '"event":"telegram.sent"'`.

### Debug Logging

The service uses the [`debug`](https://www.npmjs.com/package/debug) package for detailed logging. Enable debug output with the `DEBUG` environment variable:

**Basic Usage:**
```bash
# Enable all telegram-bridge debug logs
DEBUG=telegram-bridge:* npm start

# Enable only webhook debug logs
DEBUG=telegram-bridge:webhook npm start

# Enable webhook and message processing logs
DEBUG=telegram-bridge:webhook,telegram-bridge:message npm start

# Enable everything (including other packages)
DEBUG=* npm start
```

**Available Debug Namespaces:**
- `telegram-bridge:webhook` - Incoming webhook data and processing
- `telegram-bridge:message` - Message formatting and transformation
- `telegram-bridge:server` - HTTP server operations and routing
- `telegram-bridge:telegram` - Telegram API communication

**Docker Usage:**
```yaml
telegram-bridge:
  environment:
    DEBUG: "telegram-bridge:*"
  # ... other config
```

**Production Considerations:**
- Debug logging is disabled by default (no performance impact)
- Use specific namespaces in production to avoid verbose output
- For troubleshooting: `DEBUG=telegram-bridge:webhook,telegram-bridge:telegram`

## Error Handling

The service handles various error conditions gracefully:
- Invalid JSON payloads (400 response)
- Telegram API failures (500 response with details)
- Missing configuration (process exit on startup)
- Network timeouts and connection errors

Error responses include detailed error information for debugging while maintaining security.