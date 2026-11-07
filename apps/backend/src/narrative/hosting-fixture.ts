/** Shared test data: a situation with independently motivated actors and pressure. */
export function hostingFixture(situation = "敌军占据山口，堡中守军与迁民互相需要") {
  return {
    worldRuleRefs: [],
    situation,
    actors: [{ name: "巡防统领", identity: "边堡守将", goal: "保住边民与守军", forces: "巡防队与烽燧", relationships: "依靠向导，与敌军对抗" }],
    locations: [{ name: "边堡", conditions: "扼守山口", resources: "守军与烽燧", obstacles: "雨季道路受阻", connections: "山道通向邻堡" }],
    pressures: [{ source: "敌军侦察队", condition: "守军未干预山口行动", development: "敌军摸清道路并扩大封锁" }],
    stakes: ["边民安全与实际指挥权"]
  };
}
