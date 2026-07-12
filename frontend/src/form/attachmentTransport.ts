// Upload transport for FORM attachments — attaches each upload to the document.
//
// @framework/ui's default transport (createFrappeTransport) uploads to
// /api/method/upload_file but its UploadArgs carry no doctype/docname, so files land
// unattached. frappe-ui's own useFileUpload DOES accept doctype/docname (→ the File's
// attached_to_doctype / attached_to_name), so wrap it and feed those through.
import { useFileUpload as useFrappeFileUpload } from 'frappe-ui'
import type { UploadTransport } from '@framework/ui/FileUpload'

const DEFAULT_FOLDER = 'Home/Attachments'

/**
 * Build a transport bound to a document. `getDocname` is read per upload so a form
 * that navigates (same component, new docname) stays correct.
 */
export function createAttachmentTransport(
	doctype: string,
	getDocname: () => string
): UploadTransport {
	return async (file, args, ctx) => {
		const { upload } = useFrappeFileUpload()
		const result: any = await upload(file, {
			private: args.isPrivate,
			folder: args.folder || DEFAULT_FOLDER,
			optimize: args.optimize,
			max_width: args.maxWidth,
			max_height: args.maxHeight,
			doctype,
			docname: getDocname(),
			signal: ctx.signal,
			onProgress: ({ loaded, total }: { loaded: number; total: number }) =>
				ctx.onProgress(loaded, total),
		})
		return { file_url: result.file_url }
	}
}
