import type { PublicBackgroundCard, PublicNarrativeAssets, PublicNarrativeCharacter, StatKey } from "@reroll/shared";
import { NarrativeAssetsArchive } from "./NarrativeAssets";

export interface DecisionHistoryEntry {
  id: string;
  choiceLabel: string;
  choiceDescription: string;
  background: string;
  rollLabels: string[];
}

export interface DecisionHistoryGroup {
  age: number;
  ageStageLabel: string;
  entries: DecisionHistoryEntry[];
}

function rarityClass(rarity: PublicBackgroundCard["rarity"]): string {
  return `rarity-${rarity}`;
}

const rarityLabels: Record<PublicBackgroundCard["rarity"], string> = {
  common: "寻常",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说"
};

const talentStatLabels: Record<StatKey, string> = {
  intelligence: "智力",
  charisma: "魅力",
  family: "家境",
  fortune: "气运",
  physique: "体魄"
};

export function TalentArchive({ cards }: { cards: PublicBackgroundCard[] }) {
  return <details className="talent-archive">
    <summary className="archive-section-summary"><span>天赋</span><small>{cards.length}项</small></summary>
    <div className="archive-index">
      {cards.map((card) => <details className={`archive-entry talent-entry ${rarityClass(card.rarity)}`} key={card.id}>
        <summary><span>{card.name}</span><small>{rarityLabels[card.rarity]}</small></summary>
        <div className="archive-entry-content">
          <p>{card.description}</p>
          <div className="talent-modifiers">{Object.entries(card.modifiers).filter((entry): entry is [StatKey, number] => typeof entry[1] === "number" && entry[1] !== 0).map(([key, value]) => <small key={key}>{talentStatLabels[key]}{value > 0 ? "+" : ""}{value}</small>)}</div>
        </div>
      </details>)}
    </div>
  </details>;
}

function CharacterArchive({ characters }: { characters: PublicNarrativeCharacter[] }) {
  return <details className="archive-section">
    <summary className="archive-section-summary"><span>命运人物</span><small>{characters.length ? `${characters.length}人` : "尚未相逢"}</small></summary>
    <div className="archive-index">
      {characters.length ? characters.map((character) => <details className="archive-entry character-entry" key={character.id}>
        <summary><span>{character.name}</span></summary>
        <div className="archive-entry-content"><p className="character-role">{character.role}</p><p>{character.description}</p><small>{character.introducedAge}岁初见</small></div>
      </details>) : <p className="archive-empty">尚无常驻人物。</p>}
    </div>
  </details>;
}

function DecisionArchive({ groups }: { groups: DecisionHistoryGroup[] }) {
  const count = groups.reduce((total, group) => total + group.entries.length, 0);
  return <details className="archive-section decision-archive">
    <summary className="archive-section-summary"><span>往昔抉择</span><small>{count ? `${count}次` : "尚无记录"}</small></summary>
    <div className="archive-index">
      {groups.length ? groups.map((group) => <details className="archive-entry decision-age-group" key={`${group.age}-${group.ageStageLabel}`}>
        <summary><span>{group.age}岁 · {group.ageStageLabel}</span><small>{group.entries.length}次</small></summary>
        <div className="decision-entry-list">
          {group.entries.map((entry) => <details className="archive-entry decision-entry" key={entry.id}>
            <summary><span>{entry.choiceLabel}</span></summary>
            <div className="archive-entry-content">
              <p>{entry.background || "你走到了命运分岔口。"}</p>
              <p className="decision-result">你的选择：{entry.choiceDescription}</p>
              {entry.rollLabels.length ? <div className="decision-history-rolls">{entry.rollLabels.map((label, index) => <small key={`${entry.id}-roll-${index}`}>{label}</small>)}</div> : null}
            </div>
          </details>)}
        </div>
      </details>) : <p className="archive-empty">尚未走到分岔处。</p>}
    </div>
  </details>;
}

export function FateArchiveContent({
  assets,
  characters,
  decisions,
  headingId
}: {
  assets?: PublicNarrativeAssets;
  characters: PublicNarrativeCharacter[];
  decisions: DecisionHistoryGroup[];
  headingId?: string;
}) {
  return <>
    <header className="fate-archive-heading"><small>此生所留</small><h2 id={headingId}>命运档案</h2></header>
    <div className="fate-archive-sections">
      <CharacterArchive characters={characters} />
      <NarrativeAssetsArchive assets={assets} />
      <DecisionArchive groups={decisions} />
    </div>
  </>;
}
