/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * loader holding, module-table seeding, AppRoot gate, plugin assembly — lives
 * in @williamcodebox/omd-client-web; this file only finds the mount point.
 */
import { AppWebEntry } from '@williamcodebox/omd-client-web'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
