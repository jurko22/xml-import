const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise, Builder } = require('xml2js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const xmlUrl = "https://raw.githubusercontent.com/jurko22/xml-feed/main/feed.xml";

async function importXMLFeed() {
    try {
        console.log("🚀 Fetching XML feed...");
        const response = await fetch(xmlUrl);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const xmlContent = await response.text();
        const parsedData = await parseStringPromise(xmlContent);
        const items = parsedData.SHOP.SHOPITEM || [];

        const products = items.map((item) => ({
            id: item.$.id ? parseInt(item.$.id, 10) : null,
            name: item.NAME?.[0] || "Unknown",
            image_url: item.IMAGES?.[0]?.IMAGE?.[0]?._ || null,
            sizes: (item.VARIANTS?.[0]?.VARIANT || []).map(variant => ({
                size: variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown",
                price: parseFloat(variant.PRICE_VAT?.[0] || 0),
                status: variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Neznámy"
            }))
        }));

        if (products.length === 0) {
            console.log("❌ No products found in XML feed.");
            return;
        }

        console.log("📡 Fetching existing product sizes from Supabase...");
        const { data: existingSizes, error: sizeFetchError } = await supabase
            .from('product_sizes')
            .select('product_id, size, original_price');

        if (sizeFetchError) {
            console.error("❌ Error fetching sizes:", sizeFetchError);
            return;
        }

        const sizeMap = new Map(existingSizes.map(s => [`${s.product_id}-${s.size}`, s.original_price]));

        let sizesToInsert = [];
        let sizesToUpdate = [];

        for (const product of products) {
            for (const variant of product.sizes) {
                const key = `${product.id}-${variant.size}`;
                const existingOriginalPrice = sizeMap.get(key);

                if (existingOriginalPrice === undefined) {
                    // Prvý import, uložíme pôvodnú cenu
                    sizesToInsert.push({
                        product_id: product.id,
                        size: variant.size,
                        price: variant.price,
                        status: variant.status,
                        original_price: variant.price
                    });
                } else {
                    // Cena sa mení, ale original_price zostáva rovnaká
                    sizesToUpdate.push({
                        product_id: product.id,
                        size: variant.size,
                        price: variant.price,
                        status: variant.status
                    });
                }
            }
        }

        if (sizesToInsert.length > 0) {
            console.log(`➕ Inserting ${sizesToInsert.length} new size records...`);
            await supabase.from('product_sizes').insert(sizesToInsert);
        }

        if (sizesToUpdate.length > 0) {
            console.log(`🔄 Updating ${sizesToUpdate.length} size records...`);
            for (const size of sizesToUpdate) {
                await supabase
                    .from('product_sizes')
                    .update({ price: size.price, status: size.status })
                    .eq('product_id', size.product_id)
                    .eq('size', size.size);
            }
        }

        console.log("📡 Fetching user products for price overrides...");
        const { data: userProducts, error: userProductsError } = await supabase
            .from('user_products')
            .select('product_id, size, price');

        if (userProductsError) {
            console.error("❌ Error fetching user products:", userProductsError);
            return;
        }

        // Generovanie aktualizovaného XML feedu
        console.log("🛠 Updating XML feed...");
        const updatedItems = products.map(product => {
            let hasExpresne = false; 

            const variants = product.sizes.map(variant => {
                const key = `${product.id}-${variant.size}`;
                const userPrice = userProducts.find(up => up.product_id === product.id && up.size === variant.size)?.price;
                const originalPrice = sizeMap.get(key) || variant.price;
                const newPrice = userPrice !== undefined ? userPrice : originalPrice;
                const newStatus = userPrice !== undefined ? "SKLADOM EXPRES" : "SKLADOM";

                if (newStatus === "SKLADOM EXPRES") hasExpresne = true;

                return {
                    PARAMETERS: [{ PARAMETER: [{ VALUE: [variant.size] }] }],
                    PRICE_VAT: [newPrice.toString()],
                    AVAILABILITY_OUT_OF_STOCK: [newStatus]
                };
            });

            const flags = [
                { CODE: "expresne-odoslanie", ACTIVE: hasExpresne ? "1" : "0" }
            ];

            return {
                $: { id: product.id },
                NAME: [product.name],
                IMAGES: [{ IMAGE: [product.image_url] }],
                VARIANTS: [{ VARIANT: variants }],
                FLAGS: [{ FLAG: flags.map(flag => ({ CODE: flag.CODE, ACTIVE: flag.ACTIVE })) }]
            };
        });

        const builder = new Builder();
        const updatedXml = builder.buildObject({ SHOP: { SHOPITEM: updatedItems } });

        const xmlFilePath = './updated_feed.xml';
        fs.writeFileSync(xmlFilePath, updatedXml);
        console.log("✅ XML Feed updated!");

    } catch (error) {
        console.error("❌ Error importing XML feed:", error);
    }
}

importXMLFeed();
