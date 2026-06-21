export function isWarmupOpen(tour) {
  return (tour?.status || "idle") === "idle" && tour?.closed !== true;
}

export function isActivityFinished(tour) {
  return tour?.status === "done";
}

export function warmupStatusMessage(tour) {
  if (isActivityFinished(tour)) {
    return "Активность завершена. Новые бои больше не проводятся.";
  }
  if (!isWarmupOpen(tour)) {
    return "Разминка закрыта — турнир уже сформирован.";
  }
  return "";
}

export function isNavAvailable(page, tour) {
  if (page === "arena") return isWarmupOpen(tour);
  if (page === "tournament") return !isActivityFinished(tour);
  if (page === "guide") return !isActivityFinished(tour);
  return true;
}
