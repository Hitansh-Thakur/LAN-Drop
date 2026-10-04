# SecureLAN

A simple peer-to-peer LAN sharing MVP for files, pasted text, and clipboard content.

## What it does

SecureLAN discovers other SecureLAN instances through a small WebSocket signaling service. Once two browsers connect, the actual payload is sent through a WebRTC DataChannel rather than through the signaling server.

The MVP supports:

- LAN peer discovery through the signaling server
- Selecting a peer
- WebRTC DataChannel transfer
- Files of arbitrary type
- Pasted text
- Clipboard text
- SHA-256 integrity verification
- Progress reporting
- No database and no cloud storage

## Security model

WebRTC DataChannels are encrypted by WebRTC's transport security mechanisms. SecureLAN does not implement its own AES, RSA, or ECDH layer in this MVP. This avoids custom cryptography and keeps the project focused on secure peer-to-peer networking.

SHA-256 is calculated on the original payload before sending and again after receiving. A transfer is accepted only when the hashes match.

Important limitation: this MVP does not authenticate device identities. The signaling server is trusted to relay signaling messages, and the application does not implement a separate identity/signature layer to prevent a signaling-level man-in-the-middle attack. Treat authentication as a future version feature.

## Architecture

```text
Browser A                         Browser B
    |                                  |
    |---- WebSocket signaling ---------|
    |                                  |
    |<========= WebRTC ===============>|
    |       DataChannel payload        |
    |                                  |
    | SHA-256                   SHA-256|
```

The Node.js server does not receive the file payload in the intended flow. It maintains a list of connected peers and forwards WebRTC signaling messages.

## Project structure

```text
securelan/
├── client/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server/
│   ├── server.js
│   └── package.json
├── package.json
├── .gitignore
└── README.md
```

## Requirements

- Node.js 18+
- A modern browser with WebRTC and Web Crypto support
- Two or more PCs on the same LAN

## Run the signaling server

From the project root:

```bash
npm run install-all
npm start
```

The server listens on port `3000` on all network interfaces.

It will print LAN addresses such as:

```text
SecureLAN signaling server: http://0.0.0.0:3000
LAN addresses: [ '192.168.1.20' ]
```

## Serve the client

For the easiest development setup, use any static HTTP server from the `client` directory. For example, if Python is installed:

```bash
cd client
python -m http.server 5173 --bind 0.0.0.0
```

Then open:

```text
http://<server-lan-ip>:5173
```

on every PC.

The client currently assumes the signaling server is reachable at port `3000` on the same hostname used for the web page.

For example, if the page is opened at:

```text
http://192.168.1.20:5173
```

the client connects to:

```text
ws://192.168.1.20:3000
```

## Using SecureLAN

1. Start the signaling server on one PC.
2. Start the static client server on that PC.
3. Open the client URL on all PCs on the same LAN.
4. Each browser registers with a generated device ID and a local display name.
5. Other online devices appear in the device list.
6. Select a destination device.
7. Choose a file or enter text.
8. SecureLAN establishes a WebRTC DataChannel.
9. The payload is streamed in chunks.
10. The receiver calculates SHA-256 and compares it with the sender's hash.
11. A verified file is downloaded automatically; verified text is displayed in the Received section.

## Protocol

### WebSocket messages

Registration:

```json
{
  "type": "register",
  "id": "device-id",
  "name": "My-PC"
}
```

Signaling:

```json
{
  "type": "signal",
  "to": "peer-id",
  "data": {}
}
```

The server forwards the signaling data to the selected peer.

### WebRTC DataChannel messages

Transfer start:

```json
{
  "type": "start",
  "id": "transfer-id",
  "meta": {
    "type": "file",
    "name": "example.pdf",
    "size": 12345,
    "hash": "sha256...",
    "mime": "application/pdf"
  }
}
```

Binary chunks follow the start message.

Transfer end:

```json
{
  "type": "end",
  "id": "transfer-id"
}
```

## Why WebRTC?

HTTP and WebSocket can both transfer files, but WebRTC DataChannel is a natural fit for a LocalSend-like peer-to-peer application. The signaling server is used only to establish the connection. Once the DataChannel is established, the application sends the payload directly through the WebRTC peer connection when the network permits direct connectivity.

WebRTC can use ICE, STUN, and TURN in more general Internet deployments. This MVP uses an empty `iceServers` configuration because the target environment is a shared LAN. For Internet-wide use, ICE/STUN/TURN configuration would need to be added.

## Why SHA-256?

SHA-256 is not used as encryption. It is used as an integrity check:

```text
original payload -> SHA-256 -> sender hash

received payload -> SHA-256 -> receiver hash

sender hash == receiver hash
        |
        +---- transfer integrity verified
```

If the hashes differ, SecureLAN reports an integrity failure and does not save/display the received payload.

## Important MVP limitations

- No device authentication
- No persistent device identity
- No user accounts
- No transfer history
- No Internet/NAT traversal configuration
- No resume after interruption
- Files are buffered in browser memory before verification
- Large files may therefore consume substantial browser memory
- Clipboard access depends on browser permission and security context
- The current UI is intentionally basic

## Future improvements

1. Persistent device identity and public-key authentication
2. Protection against signaling-level man-in-the-middle attacks
3. Better large-file streaming without buffering the complete file
4. Resume interrupted transfers
5. Transfer cancellation
6. Multiple simultaneous transfers
7. Better LAN discovery independent of the signaling server
8. STUN/TURN for cross-network transfers
9. Optional compression for compressible file types
10. Transfer history and audit logs

## Security testing ideas

### Test 1: File integrity

Send a file and verify that the receiver reports a successful SHA-256 match.

### Test 2: Deliberate corruption

For a controlled development test, modify a received byte before hashing it and verify that the calculated hash no longer matches.

### Test 3: Network observation

Use browser developer tools or a packet capture tool in your own lab to observe that the application payload is not sent as ordinary HTTP file data. WebRTC's transport security protects the DataChannel.

### Test 4: Peer discovery

Start three browser instances on the LAN and verify that each sees the other registered devices.

## License

Use and modify this project for educational purposes.
