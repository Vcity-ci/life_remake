import type { PublicNarrativeAssets, NarrativeAssetMoment } from "@reroll/shared";

function momentLabel(moment: NarrativeAssetMoment): string {
  return moment.ageFrom !== undefined && moment.ageFrom < moment.age
    ? `${moment.ageFrom}-${moment.age}岁间`
    : `${moment.age}岁`;
}

export function NarrativeAssetsPanel({ assets }: { assets?: PublicNarrativeAssets }) {
  const current = assets?.locations.find((entry) => entry.id === assets.currentLocationId);
  return <>
    <section className="rail-section narrative-assets" aria-label="足迹">
      <h3>足迹</h3>
      {current ? <p className="current-place"><small>此刻所在</small><strong>{current.name}</strong><span>{current.description}</span></p> : <small>行迹尚未展开</small>}
      {Boolean(assets?.locations.length) && <details className="asset-archive"><summary>地点记忆 · {assets!.locations.length}</summary>
        {assets!.locations.map((entry) => <details className="asset-detail" key={entry.id}>
          <summary>{entry.name}{entry.id === current?.id ? <small>当前</small> : null}</summary>
          <p>{entry.description}</p><small>{momentLabel(entry.introduced)}记于此生</small>
        </details>)}
      </details>}
    </section>
    <section className="rail-section narrative-assets" aria-label="本领">
      <h3>本领</h3>
      {assets?.abilities.length ? assets.abilities.map((entry) => <details className={`asset-detail${entry.status === "unavailable" ? " is-unavailable" : ""}`} key={entry.id}>
        <summary><span>{entry.name}</span><small>{entry.mastery}</small></summary>
        <p>{entry.description}</p><p className="asset-source">{entry.source}</p>
        <small>{momentLabel(entry.introduced)}习得{entry.status === "unavailable" ? " · 暂不可用" : ""}</small>
      </details>) : <small>所学尚待积累</small>}
    </section>
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
