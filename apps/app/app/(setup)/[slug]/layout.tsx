import { OrgQueryScope } from "@/lib/trpc/client";

/** Setup pages read and write the organization in the URL, so they get its cache. */
export default async function SetupLayout({
	children,
	params,
}: LayoutProps<"/[slug]">) {
	const { slug } = await params;

	return <OrgQueryScope slug={slug}>{children}</OrgQueryScope>;
}
