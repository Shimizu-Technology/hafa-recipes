// Appended to the generated controller's own file so tests invoke the actual
// private X/backdrop/Escape path, not a manually-settled model or replica.
extension ShareViewController {
  func prepareTestCapture(key: String, id: String, files: HafaShareAttachmentFiles, recoveryDelay: TimeInterval = 12) {
    card = HafaShareModel(preview: .init(title: "Test photo"), action: "Save")
    card?.isBusy = false; card?.canSave = true
    captureDurable = true; captureKind = .photos(1)
    confirmationCaptureKey = key; confirmationCaptureID = id
    captureAccountScopeID = "scope-a"; attachmentFiles = files
    saveRecoveryDelay = recoveryDelay
  }
  var testState: HafaShareSaveState { card!.saveState }
  var testCanLeave: Bool { card!.canLeave }
  var testClosed: Bool { captureClosed }
  var testNote: String { card?.note ?? "" }
  func tapTestSave() { submitCapture() }
  func tapTestClose() { cancelCapture() }
  func tapTestDiscard() { discardCapture() }
}
