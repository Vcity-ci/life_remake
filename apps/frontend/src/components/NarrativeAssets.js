import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
function momentLabel(moment) {
    return moment.ageFrom !== undefined && moment.ageFrom < moment.age
        ? `${moment.ageFrom}-${moment.age}岁间`
        : `${moment.age}岁`;
}
export function NarrativeAssetsPanel({ assets }) {
    const current = assets?.locations.find((entry) => entry.id === assets.currentLocationId);
    return _jsxs(_Fragment, { children: [_jsxs("section", { className: "rail-section narrative-assets", "aria-label": "\u8DB3\u8FF9", children: [_jsx("h3", { children: "\u8DB3\u8FF9" }), current ? _jsxs("p", { className: "current-place", children: [_jsx("small", { children: "\u6B64\u523B\u6240\u5728" }), _jsx("strong", { children: current.name }), _jsx("span", { children: current.description })] }) : _jsx("small", { children: "\u884C\u8FF9\u5C1A\u672A\u5C55\u5F00" }), Boolean(assets?.locations.length) && _jsxs("details", { className: "asset-archive", children: [_jsxs("summary", { children: ["\u5730\u70B9\u8BB0\u5FC6 \u00B7 ", assets.locations.length] }), assets.locations.map((entry) => _jsxs("details", { className: "asset-detail", children: [_jsxs("summary", { children: [entry.name, entry.id === current?.id ? _jsx("small", { children: "\u5F53\u524D" }) : null] }), _jsx("p", { children: entry.description }), _jsxs("small", { children: [momentLabel(entry.introduced), "\u8BB0\u4E8E\u6B64\u751F"] })] }, entry.id))] })] }), _jsxs("section", { className: "rail-section narrative-assets", "aria-label": "\u672C\u9886", children: [_jsx("h3", { children: "\u672C\u9886" }), assets?.abilities.length ? assets.abilities.map((entry) => _jsxs("details", { className: `asset-detail${entry.status === "unavailable" ? " is-unavailable" : ""}`, children: [_jsxs("summary", { children: [_jsx("span", { children: entry.name }), _jsx("small", { children: entry.mastery })] }), _jsx("p", { children: entry.description }), _jsx("p", { className: "asset-source", children: entry.source }), _jsxs("small", { children: [momentLabel(entry.introduced), "\u4E60\u5F97", entry.status === "unavailable" ? " · 暂不可用" : ""] })] }, entry.id)) : _jsx("small", { children: "\u6240\u5B66\u5C1A\u5F85\u79EF\u7D2F" })] })] });
}
export function NarrativeAssetChanges({ current, previous }) {
    if (!current)
        return null;
    const place = current.locations.find((entry) => entry.id === current.currentLocationId);
    const moved = place && current.currentLocationId !== previous?.currentLocationId;
    const changed = current.abilities.filter((entry) => {
        const old = previous?.abilities.find((item) => item.id === entry.id);
        return !old || old.mastery !== entry.mastery || old.status !== entry.status || old.description !== entry.description || old.name !== entry.name;
    });
    if (!moved && !changed.length)
        return null;
    return _jsxs("div", { className: "narrative-asset-changes", children: [moved ? _jsxs("span", { children: ["\u884C\u81F3 \u00B7 ", place.name] }) : null, changed.map((entry) => _jsxs("span", { children: [entry.name, " \u00B7 ", entry.status === "unavailable" ? "暂不可用" : entry.mastery] }, entry.id))] });
}
