/**
 * Replicated from `modules/rev_plan_mod.js` (define -> require).
 */
/* global require */
require(['N/record'], (record) => {


  const exported = { }

  if (typeof window !== 'undefined') window.pm_rev_plan_mod = exported
  console.log('Loaded pm_rev_plan_mod', exported)
})

