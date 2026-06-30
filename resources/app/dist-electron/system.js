"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemStore = void 0;
const node_events_1 = require("node:events");
const TEXT_LIMIT = 300;
function clamp(s, max = TEXT_LIMIT) {
    if (typeof s !== "string")
        return "";
    return s.length > max ? s.slice(0, max) + "…" : s;
}
class SystemStore extends node_events_1.EventEmitter {
    state = {
        media: null,
        bridgeReady: false,
    };
    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }
    setReady(mediaOk) {
        this.state.bridgeReady = true;
        void mediaOk;
        this.emit("change", this.getState());
    }
    setMedia(playing, title, artist, app) {
        // No title at all = nothing meaningful to show.
        if (!title || title.length === 0) {
            this.state.media = null;
        }
        else {
            this.state.media = {
                playing,
                title: clamp(title, 160),
                artist: clamp(artist, 120),
                app: clamp(app, 120),
                updatedAt: new Date().toISOString(),
            };
        }
        this.emit("change", this.getState());
    }
    clearMedia() {
        if (this.state.media !== null) {
            this.state.media = null;
            this.emit("change", this.getState());
        }
    }
}
exports.SystemStore = SystemStore;
//# sourceMappingURL=system.js.map