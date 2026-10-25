import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
function momentLabel(moment) {
    return moment.ageFrom !== undefined && moment.ageFrom < moment.age
        ? `${moment.ageFrom}-${moment.age}岁间`
        : `${moment.age}岁`;
}
export function NarrativeAssetsArchive({ assets, characters = [] }) {
    const current = assets?.locations.find((entry) => entry.id === assets.currentLocationId);
    return _jsxs(_Fragment, { children: [_jsxs("details", { className: "archive-section narrative-assets", children: [_jsxs("summary", { className: "archive-section-summary", children: [_jsx("span", { children: "\u8DB3\u8FF9" }), _jsx("small", { children: assets?.locations.length ? `${assets.locations.length}处${current ? ` · 此刻：${current.name}` : ""}` : "尚未展开" })] }), _jsx("div", { className: "archive-index", children: assets?.locations.length ? assets.locations.map((entry) => _jsxs("details", { className: "archive-entry", children: [_jsxs("summary", { children: [_jsx("span", { children: entry.name }), entry.id === current?.id ? _jsx("small", { className: "archive-current", children: "\u5F53\u524D" }) : null] }), _jsxs("div", { className: "archive-entry-content", children: [entry.description ? _jsx("p", { children: entry.description }) : null, entry.spatialDescription && entry.spatialDescription !== entry.description ? _jsxs("p", { children: ["\u7A7A\u95F4\uFF1A", entry.spatialDescription] }) : null, entry.parentLocationId && assets.locations.some((place) => place.id === entry.parentLocationId) ? _jsxs("p", { children: ["\u6240\u5C5E\uFF1A", assets.locations.find((place) => place.id === entry.parentLocationId).name] }) : null, entry.features?.map((feature, index) => _jsxs("p", { children: [feature.name, "\uFF1A", feature.state] }, `feature-${index}`)), entry.actors?.map((actor, index) => _jsx("p", { children: [actor.organizationName, actor.characterIds?.map((id) => characters.find((person) => person.id === id)?.name).filter(Boolean).join("、"), actor.relation].filter(Boolean).join(" · ") }, `actor-${index}`)), _jsxs("small", { children: [momentLabel(entry.introduced), "\u8BB0\u4E8E\u6B64\u751F"] })] })] }, entry.id)) : _jsx("p", { className: "archive-empty", children: "\u884C\u8FF9\u5C1A\u672A\u5C55\u5F00\u3002" }) })] }), _jsxs("details", { className: "archive-section narrative-assets", children: [_jsxs("summary", { className: "archive-section-summary", children: [_jsx("span", { children: "\u672C\u9886" }), _jsx("small", { children: assets?.abilities.length ? `${assets.abilities.length}项` : "尚待积累" })] }), _jsx("div", { className: "archive-index", children: assets?.abilities.length ? assets.abilities.map((entry) => _jsxs("details", { className: "archive-entry ability-entry", children: [_jsxs("summary", { children: [_jsx("span", { children: entry.name }), _jsx("small", { children: entry.mastery })] }), _jsxs("div", { className: "archive-entry-content", children: [entry.mastery ? _jsxs("p", { className: "asset-mastery", children: [_jsx("strong", { children: "\u7A0B\u5EA6\uFF1A" }), entry.mastery] }) : null, entry.description ? _jsx("p", { children: entry.description }) : null, entry.usage ? _jsx("p", { children: entry.usage }) : null, entry.source ? _jsxs("p", { className: "asset-source", children: ["\u6765\u5904\uFF1A", entry.source] }) : null, _jsxs("small", { children: [momentLabel(entry.introduced), "\u8BB0\u4E8E\u6B64\u751F"] })] })] }, entry.id)) : _jsx("p", { className: "archive-empty", children: "\u672C\u9886\u4E0E\u5B9D\u7269\u5C1A\u5F85\u79EF\u7D2F\u3002" }) })] })] });
}
export function NarrativeAssetChanges({ current, previous }) {
    if (!current)
        return null;
    const place = current.locations.find((entry) => entry.id === current.currentLocationId);
    const moved = place && current.currentLocationId !== previous?.currentLocationId;
    const revisited = moved && previous?.locations.some((entry) => entry.id === place.id);
    const changed = current.abilities.filter((entry) => {
        const old = previous?.abilities.find((item) => item.id === entry.id);
        return !old || old.mastery !== entry.mastery || old.description !== entry.description || old.usage !== entry.usage || old.name !== entry.name;
    });
    if (!moved && !changed.length)
        return null;
    return _jsxs("div", { className: "narrative-asset-changes", children: [moved ? _jsxs("span", { children: [revisited ? "重返" : "行至", " \u00B7 ", place.name] }) : null, changed.map((entry) => _jsxs("span", { children: [entry.name, entry.mastery ? ` · ${entry.mastery}` : ""] }, entry.id))] });
}
