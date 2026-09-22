import React, { useEffect } from "react";
import type { PublicStoryPackOption } from "@reroll/shared";

interface StoryPackPickerModalProps {
  worldName: string;
  storyPacks: PublicStoryPackOption[];
  selectedId: string;
  onSelect: (storyPackId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function StoryPackPickerModal({
  worldName,
  storyPacks,
  selectedId,
  onSelect,
  onConfirm,
  onClose
}: StoryPackPickerModalProps): React.JSX.Element {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-mask story-pack-modal-mask"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal story-pack-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-pack-modal-title"
      >
        <header className="story-pack-modal-heading">
          <div>
            <small>{worldName}</small>
            <h2 id="story-pack-modal-title">选择此生路线</h2>
            <p>路线决定本局故事的大纲与目标，人物经历与抉择仍由你的选择展开。</p>
          </div>
          <button className="story-pack-modal-close" type="button" aria-label="暂不选择路线" onClick={onClose}>×</button>
        </header>

        {storyPacks.length ? (
          <div className="story-pack-grid story-pack-modal-grid">
            {storyPacks.map((pack) => (
              <button
                type="button"
                key={pack.id}
                className={`story-pack-card${selectedId === pack.id ? " selected" : ""}`}
                aria-pressed={selectedId === pack.id}
                onClick={() => onSelect(pack.id)}
              >
                <strong>{pack.name}</strong>
                <span>{pack.tagline}</span>
                <small>{pack.summary}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="story-pack-empty">该世界的 IF 剧情包尚待扩展，请返回 Setting 选择已有剧情包的世界。</p>
        )}

        <footer className="story-pack-modal-actions">
          <button className="ghost" type="button" onClick={onClose}>稍后选择</button>
          <button type="button" disabled={!storyPacks.some((pack) => pack.id === selectedId)} onClick={onConfirm}>
            确认路线
          </button>
        </footer>
      </section>
    </div>
  );
}
