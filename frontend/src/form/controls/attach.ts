// attach.ts — Attach / Attach Image controls.
//
// Thin over ControlData: the value is the file URL, and the Vue component owns the
// upload UI + preview. No client-side upload plumbing lives on the control.
import { FrappeControlData } from './frappeControl'

export class FrappeControlAttach extends FrappeControlData {}
