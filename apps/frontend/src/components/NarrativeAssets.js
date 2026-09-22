import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
function momentLabel(moment) {
    return moment.ageFrom !== undefined && moment.ageFrom < moment.age
        ? `${moment.ageFrom}-${moment.age}岁间`
        : `${moment.age}岁`;
}
export function NarrativeAssetsArchive({ assets }) {
    const current = assets?.locations.find((entry) => entry.id === assets.currentLocationId);
    return _jsxs(_Fragment, { children: [_jsxs("details", { className: "archive-section narrative-assets", children: [_jsxs("summary", { className: "archive-section-summary", children: [_jsx("span", { children: "\u8DB3\u8FF9" }), _jsx("small", { children: assets?.locations.length ? `${assets.locations.length}处${current ? ` · 此刻：${current.name}` : ""}` : "尚未展开" })] }), _jsx("div", { className: "archive-index", children: assets?.locations.length ? assets.locations.map((entry) => _jsxs("details", { className: "archive-entry", children: [_jsxs("summary", { children: [_jsx("span", { children: entry.name }), entry.id === current?.id ? _jsx("small", { className: "archive-current", children: "\u5F53\u524D" }) : null] }), _jsxs("div", { className: "archive-entry-content", children: [_jsx("p", { children: entry.description }), _jsxs("small", { children: [momentLabel(entry.introduced), "\u8BB0\u4E8E\u6B64\u751F"] })] })] }, entry.id)) : _jsx("p", { className: "archive-empty", children: "\u884C\u8FF9\u5C1A\u672A\u5C55\u5F00\u3002" }) })] }), _jsxs("details", { className: "archive-section narrative-assets", children: [_jsxs("summary", { className: "archive-section-summary", children: [_jsx("span", { children: "\u672C\u9886" }), _jsx("small", { children: assets?.abilities.length ? `${assets.abilities.length}项` : "尚待积累" })] }), _jsx("div", { className: "archive-index", children: assets?.abilities.length ? assets.abilities.map((entry) => _jsxs("details", { className: `archive-entry ability-entry${entry.status === "unavailable" ? " is-unavailable" : ""}`, children: [_jsxs("summary", { children: [_jsx("span", { children: entry.name }), _jsx("small", { children: entry.status === "unavailable" ? "暂不可用" : "可用" })] }), _jsxs("div", { className: "archive-entry-content", children: [_jsxs("p", { className: "asset-mastery", children: [_jsx("strong", { children: "\u638C\u63E1\uFF1A" }), entry.mastery] }), _jsx("p", { children: entry.description }), _jsxs("p", { className: "asset-source", children: ["\u6765\u5904\uFF1A", entry.source] }), _jsxs("small", { children: [momentLabel(entry.introduced), "\u4E60\u5F97"] })] })] }, entry.id)) : _jsx("p", { className: "archive-empty", children: "\u6240\u5B66\u5C1A\u5F85\u79EF\u7D2F\u3002" }) })] })] });
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
