Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.open = true
  },
  close(this: HTMLDialogElement) {
    this.open = false
  },
})
