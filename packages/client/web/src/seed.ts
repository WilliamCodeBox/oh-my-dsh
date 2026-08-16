/**
 * Platform-singleton module-table. These are the ONLY entities the shell
 * shares into the frozen module table — fetch bundles resolve their externals
 * against exactly this set through the loader's require. Keys come from the
 * platform constant module ({@link ./platform.ts}, the single source
 * of truth with the tsdown client externals); values stay shell-static
 * imports so every bundle sees the same instance.
 */
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Cordis from '@williamcodebox/cordis'
import * as UiSlots from '@williamcodebox/omd-client-ui-slots'
import * as WebReact from '@williamcodebox/omd-client-web-react'
import * as UiPrimitives from '@williamcodebox/omd-client-ui-primitives'
import * as UiAttachment from '@williamcodebox/omd-client-ui-attachment'
import * as SchemaForm from '@williamcodebox/omd-client-schema-form'
import type { PlatformModule } from './platform.ts'

/**
 * Build the static table handed to the module loader at boot.
 * @returns module specifier → exported entity (one entry per platform word).
 */
export function getStaticModules(): Record<string, unknown> {
  // The satisfies pin is the projection contract: a word added to
  // PLATFORM_MODULES without a static import here (or vice versa) fails to
  // compile instead of drifting into a runtime require miss.
  return {
    'react': React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    '@williamcodebox/cordis': Cordis,
    '@williamcodebox/omd-client-ui-slots': UiSlots,
    '@williamcodebox/omd-client-web-react': WebReact,
    '@williamcodebox/omd-client-ui-primitives': UiPrimitives,
    '@williamcodebox/omd-client-ui-attachment': UiAttachment,
    '@williamcodebox/omd-client-schema-form': SchemaForm,
  } satisfies Record<PlatformModule, unknown>
}
