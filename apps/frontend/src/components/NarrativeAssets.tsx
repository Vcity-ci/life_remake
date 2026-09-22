import type { PublicNarrativeAssets, NarrativeAssetMoment } from "@reroll/shared";

function momentLabel(moment: NarrativeAssetMoment): string {
  return moment.ageFrom !== undefined && moment.ageFrom < moment.age
    ? `${moment.ageFrom}-${moment.age}岁间`
    : `${moment.age}岁`;
}

export function NarrativeAssetsArchive({ assets }: { assets?: PublicNarrativeAssets }) {
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
          <div className="archive-entry-content"><p>{entry.description}</p><small>{momentLabel(entry.introduced)}记于此生</small></div>
        </details>) : <p className="archive-empty">行迹尚未展开。</p>}
      </div>
    </details>
    <details className="archive-section narrative-assets">
      <summary className="archive-section-summary">
        <span>本领</span>
        <small>{assets?.abilities.length ? `${assets.abilities.length}项` : "尚待积累"}</small>
      </summary>
      <div className="archive-index">
        {assets?.abilities.length ? assets.abilities.map((entry) => <details className={`archive-entry ability-entry${entry.status === "unavailable" ? " is-unavailable" : ""}`} key={entry.id}>
          <summary><span>{entry.name}</span><small>{entry.status === "unavailable" ? "暂不可用" : "可用"}</small></summary>
          <div className="archive-entry-content"><p className="asset-mastery"><strong>掌握：</strong>{entry.mastery}</p><p>{entry.description}</p><p className="asset-source">来处：{entry.source}</p><small>{momentLabel(entry.introduced)}习得</small></div>
        </details>) : <p className="archive-empty">所学尚待积累。</p>}
      </div>
    </details>
  </>;
}

export function NarrativeAssetChanges({ current, previous }: { current?: PublicNarrativeAssets; previous?: PublicNarrativeAssets }) {
  if (!current) return null;
  const place = current.locations.find((entry) => entry.id === current.currentLocationId);
  const moved = place && current.currentLocationId !== previous?.currentLocationId;
  const changed = current.abilities.filter((entry) => {
    const old = previous?.abilities.find((item) => item.id === entry.id);
    return !old || old.mastery !== entry.mastery || old.status !== entry.status || old.description !== entry.description || old.name !== entry.name;
  });
  if (!moved && !changed.length) return null;
  return <div className="narrative-asset-changes">
    {moved ? <span>行至 · {place.name}</span> : null}
    {changed.map((entry) => <span key={entry.id}>{entry.name} · {entry.status === "unavailable" ? "暂不可用" : entry.mastery}</span>)}
  </div>;
}
