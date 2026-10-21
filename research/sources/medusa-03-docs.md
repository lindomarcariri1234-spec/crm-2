Source: https://docs.medusajs.com/resources/recipes/marketplace
Title: Marketplace Recipe - Medusa Documentation
Fetched: 2026-10-19T05:46:36.821Z

For AI agents: a documentation index is available at [/llms.txt](https://docs.medusajs.com/llms.txt). Every page is also available as Markdown by appending .md to its URL or by requesting it with an Accept: text/markdown header.

- [Get Started](https://docs.medusajs.com/learn)
- Product







[Framework](https://docs.medusajs.com/learn/fundamentals/framework)



[Admin Extensions](https://docs.medusajs.com/learn/fundamentals/admin)



[Commerce Modules](https://docs.medusajs.com/resources/commerce-modules)



[Infrastructure Modules](https://docs.medusajs.com/resources/infrastructure-modules)

- Build







[Recipes](https://docs.medusajs.com/resources/recipes)



[How-to & Tutorials](https://docs.medusajs.com/resources/how-to-tutorials)



[Integrations](https://docs.medusajs.com/resources/integrations)



[Storefront](https://docs.medusajs.com/resources/storefront-development)

- [Tools](https://docs.medusajs.com/resources/tools)





CLI Tools



[InstantSearch Adapter](https://docs.medusajs.com/resources/instantsearch)



[JS SDK](https://docs.medusajs.com/resources/js-sdk)



[Admin Components](https://docs.medusajs.com/resources/admin-components)



[Next.js Starter](https://docs.medusajs.com/resources/nextjs-starter)



[Medusa UI](https://docs.medusajs.com/ui)



[ESLint Plugin](https://docs.medusajs.com/resources/lint)

- [Reference](https://docs.medusajs.com/resources/references-overview)





[Admin API](https://docs.medusajs.com/api/admin)



[Store API](https://docs.medusajs.com/api/store)



[Admin Injection Zones](https://docs.medusajs.com/resources/admin-widget-injection-zones)



[Container Resources](https://docs.medusajs.com/resources/medusa-container-resources)



[Core Workflows](https://docs.medusajs.com/resources/medusa-workflows-reference)



[Data Model Language](https://docs.medusajs.com/resources/references/data-model)



[Data Model Repository](https://docs.medusajs.com/resources/data-model-repository-reference)



[Events Reference](https://docs.medusajs.com/resources/references/events)



[Helper Steps](https://docs.medusajs.com/resources/references/helper-steps)



[Service Factory](https://docs.medusajs.com/resources/service-factory-reference)



[Testing Framework](https://docs.medusajs.com/resources/test-tools-reference)



[Workflows SDK](https://docs.medusajs.com/resources/references/workflows)

- [User Guide](https://docs.medusajs.com/user-guide)
- [Cloud](https://docs.medusajs.com/cloud)

[v2.21.2](https://github.com/medusajs/medusa/releases/tag/v2.21.2)

Help

[Troubleshooting](https://docs.medusajs.com/resources/troubleshooting)

[Report Issue](https://github.com/medusajs/medusa/issues/new/choose)

[Discord Community](https://discord.gg/medusajs)

[Contact Sales](https://medusajs.com/contact/)

Ask Bloom

[Homepage](https://medusajs.com/)

[Medusa v1](https://docs.medusajs.com/v1)

[Changelog](https://medusajs.com/changelog)

Hide Sidebar⌘\

Theme

Light

Dark

Menu

- [Get Started](https://docs.medusajs.com/learn)
- Product
- Build
- Tools
- Reference
- [User Guide](https://docs.medusajs.com/user-guide)
- [Cloud](https://docs.medusajs.com/cloud)

[Documentation](https://docs.medusajs.com/)[Recipes](https://docs.medusajs.com/resources/recipes)

# Marketplace Recipe

This recipe provides the general steps to implement a marketplace in your Medusa application.

## Example Guides[\#](https://docs.medusajs.com/resources/recipes/marketplace\#example-guides)

Example: Vendors

[Example: Vendors](https://docs.medusajs.com/resources/recipes/marketplace/examples/vendors)

Example: Restaurant-Delivery

[Example: Restaurant-Delivery](https://docs.medusajs.com/resources/recipes/marketplace/examples/restaurant-delivery)

## Overview[\#](https://docs.medusajs.com/resources/recipes/marketplace\#overview)

A marketplace is an online commerce store that allows different vendors to sell their products within the same commerce system. Customers can purchase products from any of these vendors, and vendors can manage their orders separately.

The Medusa [Framework](https://docs.medusajs.com/learn/fundamentals/framework) built for customizations facilitates building a marketplace. You can create a Marketplace Module that implements custom data models, such as vendors or sellers, and link those data models to existing ones such as products and orders. You also expose custom features using API routes, and implement complex flows using workflows.

Related use-case:[How Foraged built a custom marketplace with Medusa](https://medusajs.com/blog/foraged/).

* * *

## Create Custom Module with Data Models[\#](https://docs.medusajs.com/resources/recipes/marketplace\#create-custom-module-with-data-models)

In a marketplace, a business or a vendor has a user, and they can use that user to authenticate and manage the vendor's data.

You can create a marketplace module that implements data models for vendors, their admins, and any other data models that fit your use case.

Create a Module

Learn how to create a module.

[Create a Module](https://docs.medusajs.com/learn/fundamentals/modules)

Create Data Models

Create data models in the module.

[Create Data Models](https://docs.medusajs.com/learn/fundamentals/modules#1-create-data-model)

* * *

## Link Custom and Existing Data Models[\#](https://docs.medusajs.com/resources/recipes/marketplace\#link-custom-and-existing-data-models)

Since a vendor has products, orders, and other models based on your use case, you can define module links between your module's data models and the Commerce Module's data models.

For example, if you defined a vendor data model in a marketplace module, you can define a module link between the vendor and the Product Module's product data model. This builds an association between a vendor and their products, allowing you to query and manage products based on the vendor.

Define a Module Link

Learn how to define a module link.

[Define a Module Link](https://docs.medusajs.com/learn/fundamentals/module-links)

* * *

## Create Vendor API Routes[\#](https://docs.medusajs.com/resources/recipes/marketplace\#create-vendor-api-routes)

Your marketplace will most likely provide custom features for vendors, such as managing their products and orders. You can create API routes that expose these features to the vendors.

When you build these API routes, it's essential that you protect them to only allow authenticated vendors. For example, only a vendor's admin should be able to manage their products and orders.

Medusa supports creating custom actor types that can be authenticated with your custom API routes.

Create API Routes

Learn how to create an API Route in Medusa.

[Create API Routes](https://docs.medusajs.com/learn/fundamentals/api-routes)

Create an Actor Type

Learn how to create an actor type and authenticate it.

[Create an Actor Type](https://docs.medusajs.com/resources/commerce-modules/auth/create-actor-type)

* * *

## Split Orders Based on Vendors[\#](https://docs.medusajs.com/resources/recipes/marketplace\#split-orders-based-on-vendors)

If your use case allows a customer's orders to have items from different vendors, you can replicate the [Complete Cart API route](https://docs.medusajs.com/api/store/carts/complete-cart) to customize the order creation process.

In the API route, you can create a workflow that splits the order into multiple orders, one for each vendor. A workflow is a series of steps that provide features like rollback and retry mechanisms.

Replicate API Routes

Learn how to replicate an existing API route.

[Replicate API Routes](https://docs.medusajs.com/learn/fundamentals/api-routes/override)

Create a Workflow

Learn how to create a workflow in Medusa.

[Create a Workflow](https://docs.medusajs.com/learn/fundamentals/workflows)

* * *

## Customize Admin Dashboard[\#](https://docs.medusajs.com/resources/recipes/marketplace\#customize-admin-dashboard)

Based on your use case, you may need to customize the Medusa Admin to add new widgets or pages.

For example, you can create a page that lists all vendors or a widget that shows a product's vendor information.

The Medusa Admin is an extensible application within your Medusa application. You can customize it by:

- **Widgets**: Adding widgets to existing pages, such as the product page.
- **UI Routes**: Adding new pages to the Medusa Admin, such as a page to manage vendors.
- **Settings Pages**: Adding new pages to the Medusa Admin settings, such as a page to manage marketplace settings.

Create Admin Widget

Add widgets into existing admin pages.

[Create Admin Widget](https://docs.medusajs.com/learn/fundamentals/admin/widgets)

Create Admin UI Routes

Add new pages to your Medusa Admin.

[Create Admin UI Routes](https://docs.medusajs.com/learn/fundamentals/admin/ui-routes)

Create Admin Setting Page

Add new page to the Medusa Admin settings.

[Create Admin Setting Page](https://docs.medusajs.com/learn/fundamentals/admin/ui-routes#create-settings-page)

* * *

## Build Dashboard for Vendors[\#](https://docs.medusajs.com/resources/recipes/marketplace\#build-dashboard-for-vendors)

For more complex use cases, customizing the Medusa Admin may not be enough to allow vendors to manage their data.

In that case, you can build a custom dashboard for vendors that allows them to manage their data. This dashboard can interact with Medusa's Admin API and the custom API routes you created for vendors to provide a seamless experience.

Medusa Admin APIs

Learn about available APIs for the Medusa Admin.

[Medusa Admin APIs](https://docs.medusajs.com/api/admin)

* * *

## Customize or Build Storefront[\#](https://docs.medusajs.com/resources/recipes/marketplace\#customize-or-build-storefront)

Medusa provides a Next.js Starter Storefront to use with your application. You can customize it for your marketplace use case, such as showing products by vendor.

Alternatively, you can build your own storefront using the Medusa APIs. This headless approach gives you the flexibility to build a custom storefront without limitations on which tech stack you use, or the design of the storefront.

Next.js Starter Storefront

Learn how to install and customize the Next.js Starter Storefront.

[Next.js Starter Storefront](https://docs.medusajs.com/resources/nextjs-starter)

Storefront Development

Find useful guides for creating a custom storefront.

[Storefront Development](https://docs.medusajs.com/resources/storefront-development)

Was this page helpful?

It was helpfulIt wasn't helpfulReport Issue

Edited May 20, 2025· [Edit this page](https://github.com/medusajs/medusa/edit/develop/www/apps/resources/app/recipes/marketplace/page.mdx)

\[On this page\]

- [Example Guides](https://docs.medusajs.com/resources/recipes/marketplace#example-guides)
- [Overview](https://docs.medusajs.com/resources/recipes/marketplace#overview)
- [Create Custom Module with Data Models](https://docs.medusajs.com/resources/recipes/marketplace#create-custom-module-with-data-models)
- [Link Custom and Existing Data Models](https://docs.medusajs.com/resources/recipes/marketplace#link-custom-and-existing-data-models)
- [Create Vendor API Routes](https://docs.medusajs.com/resources/recipes/marketplace#create-vendor-api-routes)
- [Split Orders Based on Vendors](https://docs.medusajs.com/resources/recipes/marketplace#split-orders-based-on-vendors)
- [Customize Admin Dashboard](https://docs.medusajs.com/resources/recipes/marketplace#customize-admin-dashboard)
- [Build Dashboard for Vendors](https://docs.medusajs.com/resources/recipes/marketplace#build-dashboard-for-vendors)
- [Customize or Build Storefront](https://docs.medusajs.com/resources/recipes/marketplace#customize-or-build-storefront)

\[Shortcuts\]

[View as Markdown](https://docs.medusajs.com/resources/recipes/marketplace/index.html.md) Explain this page

\[Modules used\]

Modules used [![](https://docs.medusajs.com/resources/_next/image?url=%2Fresources%2Fimages%2Forder-icon.png&w=32&q=75)Order](https://docs.medusajs.com/resources/commerce-modules/order) [![](https://docs.medusajs.com/resources/_next/image?url=%2Fresources%2Fimages%2Fproduct-icon.png&w=32&q=75)Product](https://docs.medusajs.com/resources/commerce-modules/product)

\[What's new\]

v2.21.2 is liveSee new features and improvements [Read more](https://github.com/medusajs/medusa/releases/tag/v2.21.2 "Read more")

[Medusa Cloud](https://status.medusajs.com/)

Ask Bloom

For assistance in your development, use [Claude Code Plugins](https://docs.medusajs.com/learn/introduction/build-with-llms-ai#claude-code-plugins) or [Docs MCP server](https://docs.medusajs.com/learn/introduction/build-with-llms-ai/docs-mcp-server) in Cursor, VSCode, etc...FAQ

What is Medusa?

How can I create a module?

How can I create a data model?

How do I create a workflow?

How can I extend a data model in the Product Module?

Recipes

How do I build a marketplace with Medusa?

How do I build digital products with Medusa?

How do I build subscription-based purchases with Medusa?

What other recipes are available in the Medusa documentation?

Deep Thinking

Chat is cleared on refresh

Line break

`⇧`  `↵`

Clear

DocsStore & Admin API

Search Suggestions

Medusa Configurations

Commerce Modules

Medusa Workflows Reference

Storefront Development

Navigation`↑`  `↓`

Open Result `↵`

reCAPTCHA

Recaptcha requires verification.

protected by **reCAPTCHA**