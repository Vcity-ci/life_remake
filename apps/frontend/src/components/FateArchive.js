import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { NarrativeAssetsArchive } from "./NarrativeAssets";
function rarityClass(rarity) {
    return `rarity-${rarity}`;
}
const rarityLabels = {
    common: "寻常",
    rare: "稀有",
    epic: "史诗",
    legendary: "传说"
};
const talentStatLabels = {
    intelligence: "智力",
    charisma: "魅力",
    family: "家境",
    fortune: "气运",
    physique: "体魄"
};
export function TalentArchive({ cards }) {
    return _jsxs("details", { className: "talent-archive", children: [_jsxs("summary", { className: "archive-section-summary", children: [_jsx("span", { children: "\u5929\u8D4B" }), _jsxs("small", { children: [cards.length, "\u9879"] })] }), _jsx("div", { className: "archive-index", children: cards.map((card) => _jsxs("details", { className: `archive-entry talent-entry ${rarityClass(card.rarity)}`, children: [_jsxs("summary", { children: [_jsx("span", { children: card.name }), _jsx("small", { children: rarityLabels[card.rarity] })] }), _jsxs("div", { className: "archive-entry-content", children: [_jsx("p", { children: card.description }), _jsx("div", { className: "talent-modifiers", children: Object.entries(card.modifiers).filter((entry) => typeof entry[1] === "number" && entry[1] !== 0).map(([key, value]) => _jsxs("small", { children: [talentStatLabels[key], value > 0 ? "+" : "", value] }, key)) })] })] }, card.id)) })] });
}
function CharacterArchive({ characters }) {
    return _jsxs("details", { className: "archive-section", children: [_jsxs("summary", { className: "archive-section-summary", children: [_jsx("span", { children: "\u547D\u8FD0\u4EBA\u7269" }), _jsx("small", { children: characters.length ? `${characters.length}人` : "尚未相逢" })] }), _jsx("div", { className: "archive-index", children: characters.length ? characters.map((character) => _jsxs("details", { className: "archive-entry character-entry", children: [_jsx("summary", { children: _jsx("span", { children: character.name }) }), _jsxs("div", { className: "archive-entry-content", children: [_jsx("p", { className: "character-role", children: character.role }), _jsx("p", { children: character.description }), _jsxs("small", { children: [character.introducedAge, "\u5C81\u521D\u89C1"] })] })] }, character.id)) : _jsx("p", { className: "archive-empty", children: "\u5C1A\u65E0\u5E38\u9A7B\u4EBA\u7269\u3002" }) })] });
}
function DecisionArchive({ groups }) {
    const count = groups.reduce((total, group) => total + group.entries.length, 0);
    return _jsxs("details", { className: "archive-section decision-archive", children: [_jsxs("summary", { className: "archive-section-summary", children: [_jsx("span", { children: "\u5F80\u6614\u6289\u62E9" }), _jsx("small", { children: count ? `${count}次` : "尚无记录" })] }), _jsx("div", { className: "archive-index", children: groups.length ? groups.map((group) => _jsxs("details", { className: "archive-entry decision-age-group", children: [_jsxs("summary", { children: [_jsxs("span", { children: [group.age, "\u5C81 \u00B7 ", group.ageStageLabel] }), _jsxs("small", { children: [group.entries.length, "\u6B21"] })] }), _jsx("div", { className: "decision-entry-list", children: group.entries.map((entry) => _jsxs("details", { className: "archive-entry decision-entry", children: [_jsx("summary", { children: _jsx("span", { children: entry.choiceLabel }) }), _jsxs("div", { className: "archive-entry-content", children: [_jsx("p", { children: entry.background || "你走到了命运分岔口。" }), _jsxs("p", { className: "decision-result", children: ["\u4F60\u7684\u9009\u62E9\uFF1A", entry.choiceDescription] }), entry.rollLabels.length ? _jsx("div", { className: "decision-history-rolls", children: entry.rollLabels.map((label, index) => _jsx("small", { children: label }, `${entry.id}-roll-${index}`)) }) : null] })] }, entry.id)) })] }, `${group.age}-${group.ageStageLabel}`)) : _jsx("p", { className: "archive-empty", children: "\u5C1A\u672A\u8D70\u5230\u5206\u5C94\u5904\u3002" }) })] });
}
export function FateArchiveContent({ assets, characters, decisions, headingId }) {
    return _jsxs(_Fragment, { children: [_jsxs("header", { className: "fate-archive-heading", children: [_jsx("small", { children: "\u6B64\u751F\u6240\u7559" }), _jsx("h2", { id: headingId, children: "\u547D\u8FD0\u6863\u6848" })] }), _jsxs("div", { className: "fate-archive-sections", children: [_jsx(CharacterArchive, { characters: characters }), _jsx(NarrativeAssetsArchive, { assets: assets }), _jsx(DecisionArchive, { groups: decisions })] })] });
}
