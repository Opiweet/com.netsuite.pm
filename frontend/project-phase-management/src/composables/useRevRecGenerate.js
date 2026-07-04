import { escapeHtml, joinLabels } from '@/util'

export function useRevRecGenerate() {
  function buildMissingCompletedJournalsWarningSubtitle(preview) {
    const labels = Array.isArray(preview?.missingCompletedJournalMonthLabels)
      ? preview.missingCompletedJournalMonthLabels.filter(Boolean)
      : []
    const fallback = escapeHtml(joinLabels(labels))
    const body = labels.length
      ? `<ul class="month-lists"><li>${labels
          .map((label) => `<strong>${escapeHtml(label)}</strong>`)
          .join('</li><li>')}</li></ul>`
      : `<ul><li><strong>${fallback}</strong></li></ul>`
    return `
      Journals could not be found for the following completed month(s):
      ${body}
      You can re-generate missing journals for those completed month(s), or dismiss this warning.`
  }

  function buildGenerateConfirmationSubtitle(preview) {
    const labels = Array.isArray(preview?.generateJournalAction?.targetMonthLabels)
      ? preview.generateJournalAction.targetMonthLabels.filter(Boolean)
      : []
    const zeroValueLabels = Array.isArray(preview?.zeroValueCompletionMonthLabels)
      ? preview.zeroValueCompletionMonthLabels.filter(Boolean)
      : []
    const zeroValueSet = new Set(zeroValueLabels)
    const journalLabels = labels.filter((label) => !zeroValueSet.has(label))
    const fallback = escapeHtml(joinLabels(labels))
    const body = journalLabels.length
      ? `<ul class="month-lists"><li>${journalLabels
          .map((label) => `<strong>${escapeHtml(label)}</strong>`)
          .join('</li><li>')}</li></ul>`
      : `<ul><li><strong>${fallback}</strong></li></ul>`
    const zeroValueBody = zeroValueLabels.length
      ? `<br/>The following month(s) have no recognisable value, so no journal will be created. Their rev plans will still be moved to <code>Completed</code>:<ul class="month-lists"><li>${zeroValueLabels
          .map((label) => `<strong>${escapeHtml(label)}</strong>`)
          .join('</li><li>')}</li></ul>`
      : ''
    if (!journalLabels.length && zeroValueLabels.length) {
      return `
      No rev rec journal will be created for:
      <ul class="month-lists"><li>${zeroValueLabels
        .map((label) => `<strong>${escapeHtml(label)}</strong>`)
        .join('</li><li>')}</li></ul>
      These month(s) have no recognisable value, so their rev plans will be moved to <code>Completed</code>.
      Do you want to proceed?`
    }
    return `
      This will generate rev rec journal and move rev plans to <code>Completed</code> for:
      ${body}
      ${zeroValueBody}
      Do you want to proceed?`
  }

  function decideNormalGenerate(preview) {
    const action =
      preview?.generateJournalAction && typeof preview.generateJournalAction === 'object'
        ? preview.generateJournalAction
        : null

    if (!action?.visible || !action?.enabled) {
      throw new Error(action?.reason || 'No rev plans are Rev Rec Ready for generation.')
    }

    return {
      type: 'needs_confirm',
      mode: action?.targetsCurrentMonth ? 'current_only' : 'missing_only',
      forceMissingOpen: false,
      subtitle: buildGenerateConfirmationSubtitle(preview),
    }
  }

  function decideFromPreview(preview) {
    if (preview?.hasMissingCompletedJournals) {
      return {
        type: 'warn_missing_completed_journals',
        mode: 'completed_missing_journals_only',
        forceMissingOpen: false,
        subtitle: buildMissingCompletedJournalsWarningSubtitle(preview),
      }
    }

    return decideNormalGenerate(preview)
  }

  async function fetchPreview({ projectsStore, projectId }) {
    return projectsStore.fetchRevRecGenerationPreview({ projectId })
  }

  async function generateJournal({ projectsStore, projectId, mode, forceMissingOpen }) {
    return projectsStore.generateRevRecJournal({
      projectId,
      mode: mode || 'auto',
      forceMissingOpen: Boolean(forceMissingOpen),
    })
  }

  return {
    fetchPreview,
    decideNormalGenerate,
    decideFromPreview,
    generateJournal,
  }
}
