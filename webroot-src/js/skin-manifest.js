export const DEFAULT_SKIN_ID = "default";

export const SKINS = {
  default: {
    id: "default",
    label: "默认",
    title: "Material You",
    description: "跟随系统与 Material You 主题",
    badge: "default"
  },
  "memorial-amber": {
    id: "memorial-amber",
    label: "纪念版・琥珀纪元 / Amber Era",
    title: "琥珀纪元 / Amber Era",
    description: "温暖、怀旧、有机流体感",
    badge: "amber"
  },
  "founder-qingmu": {
    id: "founder-qingmu",
    label: "创始人版・倾慕 / Elaina",
    title: "倾慕 / Elaina",
    description: "高冷、禁欲、几何精确感",
    badge: "founder"
  }
};

export const SKIN_ORDER = ["default", "memorial-amber", "founder-qingmu"];
export const VALID_SKIN_IDS = new Set(SKIN_ORDER);

export function normalizeSkinId(value, fallback = DEFAULT_SKIN_ID) {
  const id = String(value || "").trim();
  return VALID_SKIN_IDS.has(id) ? id : fallback;
}
