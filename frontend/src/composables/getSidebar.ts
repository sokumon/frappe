// useWorkspaceSidebar.ts
import { reactive } from 'vue'

interface ERPNextItem {
  label: string
  link_to: string | null
  link_type: string
  type: 'Link' | 'Section Break'
  icon: string | null
  child: number
  collapsible: number
  indent: number
  keep_closed: number
}

interface ERPNextSidebarData {
  label: string
  items: ERPNextItem[]
  header_icon?: string
  module?: string
  app?: string
}

interface SidebarItem {
  label: string
  icon?: unknown
  to?: string
}

interface SidebarSection {
  label: string
  items: SidebarItem[]
}

interface SidebarConfig {
  header: {
    title: string
    subtitle: string
    logo: unknown
    menuItems: unknown[]
  }
  sections: SidebarSection[]
}

type AllSidebarItems = Record<string, ERPNextSidebarData>

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

function resolveIcon(iconStr: string | null): unknown {
  if (!iconStr) return LucideIcons['File']
  const pascalIcon = toPascalCase(iconStr)
  return LucideIcons[pascalIcon as keyof typeof LucideIcons] ?? LucideIcons['File']
}

export function useWorkspaceSidebar(
  allSidebarItems: AllSidebarItems,
  menuItems: unknown[] = [],
) {

  function buildRoute(item: ERPNextItem): string {
    if (!item.link_to) return ''
    switch (item.link_type) {
      case 'Workspace': return `/${item.link_to.toLowerCase().replace(/ /g, '-')}`
      case 'DocType':   return `/list/${item.link_to.replace(/ /g, '-')}`
      case 'Dashboard': return `/dashboard/${item.link_to.toLowerCase().replace(/ /g, '-')}`
      case 'Report':    return `/query-report/${item.link_to.replace(/ /g, '-')}`
      default:          return `/${item.link_to.replace(/ /g, '-')}`
    }
  }

  function transformItems(rawItems: ERPNextItem[]): SidebarSection[] {
    const sections: SidebarSection[] = []
    let currentSection: SidebarSection = { label: '', items: [] }

    for (const item of rawItems) {
      if (item.type === 'Section Break') {
        if (currentSection.items.length > 0) sections.push(currentSection)
        currentSection = { label: item.label ?? '', items: [] }
        continue
      }

      if (item.type === 'Link' && item.link_to) {
        currentSection.items.push({
          label: item.label,
          icon: resolveIcon(item.icon),
          to: buildRoute(item),
        })
      }
    }

    if (currentSection.items.length > 0) sections.push(currentSection)

    return sections
  }

  function buildSidebar(sidebarData: ERPNextSidebarData): SidebarConfig {
    return reactive<SidebarConfig>({
      header: {
        title: sidebarData.label,
        subtitle: sidebarData.app ?? '',
        logo: typeof frappe !== 'undefined'
          ? frappe.utils.get_desktop_icon(sidebarData.label, 'Solid')
          : null,
        menuItems,
      },
      sections: transformItems(sidebarData.items),
    })
  }

  function getWorkspaceSidebars(linkTo: string): string[] {
    return Object.entries(allSidebarItems).flatMap(([name, sidebar]) =>
      sidebar.items
        .filter((item) => item.link_to === linkTo)
        .map(() => sidebar.label || name)
    )
  }

  function getSidebarByName(name: string): SidebarConfig | null {
    const sidebarData = allSidebarItems[name]
    return sidebarData ? buildSidebar(sidebarData) : null
  }

  return {
    buildSidebar,
    getWorkspaceSidebars,
    getSidebarByName,
  }
}