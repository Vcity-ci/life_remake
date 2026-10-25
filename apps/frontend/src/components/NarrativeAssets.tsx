import type { PublicNarrativeAssets, PublicNarrativeCharacter, NarrativeAssetMoment } from "@reroll/shared";

function momentLabel(moment: NarrativeAssetMoment): string {
  return moment.ageFrom !== undefined && moment.ageFrom < moment.age
    ? `${moment.ageFrom}-${moment.age}岁间`
    : `${moment.age}岁`;
}

export function NarrativeAssetsArchive({ assets, characters = [] }: { assets?: PublicNarrativeAssets; characters?: PublicNarrativeCharacter[] }) {
  const current = assets?.locations.find((entry) => entry.id === assets.currentLocationId);
  return <>
    <details className="archive-section narrative-assets">
      <summary className="archive-section-summary">
        <span>足迹</span>
        <small>{assets?.locations.length ? `${assets.locations.length}处${current ? ` · 此刻：${current.name}` : ""}` : "尚未展开"}</small>
      </summary>
      <div className="archive-index">
        {assets?.locations.length ? assets.locations.map((entry) => <details className="archive-entry" key={entry.id}>
          <summary><span>{entry.name}</span>{entry.id === current?.id ? <small className="archive-current">当前</small> : null}</summary>
          <div className="archive-entry-content">
            {entry.description ? <p>{entry.description}</p> : null}
            {entry.spatialDescription && entry.spatialDescription !== entry.description ? <p>空间：{entry.spatialDescription}</p> : null}
            {entry.parentLocationId && assets.locations.some((place) => place.id === entry.parentLocationId) ? <p>所属：{assets.locations.find((place) => place.id === entry.parentLocationId)!.name}</p> : null}
            {entry.features?.map((feature, index) => <p key={`feature-${index}`}>{feature.name}：{feature.state}</p>)}
            {entry.actors?.map((actor, index) => <p key={`actor-${index}`}>{[actor.organizationName, actor.characterIds?.map((id) => characters.find((person) => person.id === id)?.name).filter(Boolean).join("、"), actor.relation].filter(Boolean).join(" · ")}</p>)}
            <small>{momentLabel(entry.introduced)}记于此生</small>
          </div>
        </details>) : <p className="archive-empty">行迹尚未展开。</p>}
      </div>
    </details>
    <details className="archive-section narrative-assets">
      <summary className="archive-section-summary">
        <span>本领</span>
        <small>{assets?.abilities.length ? `${assets.abilities.length}项` : "尚待积累"}</small>
      </summary>
      <div className="archive-index">
        {assets?.abilities.length ? assets.abilities.map((entry) => <details className="archive-entry ability-entry" key={entry.id}>
          <summary><span>{entry.name}</span><small>{entry.mastery}</small></summary>
          <div className="archive-entry-content">{entry.mastery ? <p className="asset-mastery"><strong>程度：</strong>{entry.mastery}</p> : null}{entry.description ? <p>{entry.description}</p> : null}{entry.usage ? <p>{entry.usage}</p> : null}{entry.source ? <p className="asset-source">来处：{entry.source}</p> : null}<small>{momentLabel(entry.introduced)}记于此生</small></div>
        </details>) : <p className="archive-empty">本领与宝物尚待积累。</p>}
      </div>
    </details>
  </>;
}

export function NarrativeAssetChanges({ current, previous }: { current?: PublicNarrativeAssets; previous?: PublicNarrativeAssets }) {
  if (!current) return null;
  const place = current.locations.find((entry) => entry.id === current.currentLocationId);
  const moved = place && current.currentLocationId !== previous?.currentLocationId;
  const revisited = moved && previous?.locations.some((entry) => entry.id === place.id);
  const changed = current.abilities.filter((entry) => {
    const old = previous?.abilities.find((item) => item.id === entry.id);
    return !old || old.mastery !== entry.mastery || old.description !== entry.description || old.usage !== entry.usage || old.name !== entry.name;
  });
  if (!moved && !changed.length) return null;
  return <div className="narrative-asset-changes">
    {moved ? <span>{revisited ? "重返" : "行至"} · {place.name}</span> : null}
    {changed.map((entry) => <span key={entry.id}>{entry.name}{entry.mastery ? ` · ${entry.mastery}` : ""}</span>)}
  </div>;
}
