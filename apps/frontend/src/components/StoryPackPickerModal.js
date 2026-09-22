import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
export function StoryPackPickerModal({ worldName, storyPacks, selectedId, onSelect, onConfirm, onClose }) {
    useEffect(() => {
        function onKeyDown(event) {
            if (event.key === "Escape")
                onClose();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);
    return (_jsx("div", { className: "modal-mask story-pack-modal-mask", role: "presentation", onMouseDown: (event) => {
            if (event.target === event.currentTarget)
                onClose();
        }, children: _jsxs("section", { className: "modal story-pack-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "story-pack-modal-title", children: [_jsxs("header", { className: "story-pack-modal-heading", children: [_jsxs("div", { children: [_jsx("small", { children: worldName }), _jsx("h2", { id: "story-pack-modal-title", children: "\u9009\u62E9\u6B64\u751F\u8DEF\u7EBF" }), _jsx("p", { children: "\u8DEF\u7EBF\u51B3\u5B9A\u672C\u5C40\u6545\u4E8B\u7684\u5927\u7EB2\u4E0E\u76EE\u6807\uFF0C\u4EBA\u7269\u7ECF\u5386\u4E0E\u6289\u62E9\u4ECD\u7531\u4F60\u7684\u9009\u62E9\u5C55\u5F00\u3002" })] }), _jsx("button", { className: "story-pack-modal-close", type: "button", "aria-label": "\u6682\u4E0D\u9009\u62E9\u8DEF\u7EBF", onClick: onClose, children: "\u00D7" })] }), storyPacks.length ? (_jsx("div", { className: "story-pack-grid story-pack-modal-grid", children: storyPacks.map((pack) => (_jsxs("button", { type: "button", className: `story-pack-card${selectedId === pack.id ? " selected" : ""}`, "aria-pressed": selectedId === pack.id, onClick: () => onSelect(pack.id), children: [_jsx("strong", { children: pack.name }), _jsx("span", { children: pack.tagline }), _jsx("small", { children: pack.summary })] }, pack.id))) })) : (_jsx("p", { className: "story-pack-empty", children: "\u8BE5\u4E16\u754C\u7684 IF \u5267\u60C5\u5305\u5C1A\u5F85\u6269\u5C55\uFF0C\u8BF7\u8FD4\u56DE Setting \u9009\u62E9\u5DF2\u6709\u5267\u60C5\u5305\u7684\u4E16\u754C\u3002" })), _jsxs("footer", { className: "story-pack-modal-actions", children: [_jsx("button", { className: "ghost", type: "button", onClick: onClose, children: "\u7A0D\u540E\u9009\u62E9" }), _jsx("button", { type: "button", disabled: !storyPacks.some((pack) => pack.id === selectedId), onClick: onConfirm, children: "\u786E\u8BA4\u8DEF\u7EBF" })] })] }) }));
}
