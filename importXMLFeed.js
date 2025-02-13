const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function importXMLFeed() {
    const xmlUrl = "https://raw.githubusercontent.com/jurko22/xml-feed/main/feed.xml";

    try {
        const response = await fetch(xmlUrl);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const xmlContent = await response.text();
        const parsedData = await parseStringPromise(xmlContent);
        const items = parsedData.SHOP.SHOPITEM || [];

        const products = items.map((item) => {
            const id = item.$.id ? parseInt(item.$.id, 10) : null;
            const name = item.NAME?.[0] || "Unknown";
            const imageUrl = item.IMAGES?.[0]?.IMAGE?.[0]?._ || null;
            const variants = item.VARIANTS?.[0]?.VARIANT || [];

            return {
                id,
                name,
                image_url: imageUrl,
                sizes: variants.map((variant) => ({
                    size: variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown",
                    price: parseFloat(variant.PRICE_VAT?.[0] || 0),
                    status: variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Neznámy"
                }))
            };
        });

        console.table(products.map(p => ({ id: p.id, name: p.name, sizes: p.sizes.length })));

        if (products.length === 0) {
            console.log("❌ No products found in XML feed.");
            return;
        }

        for (const product of products) {
            if (product.id === null) {
                console.warn(`⚠️ Skipping product without valid ID: ${product.name}`);
                continue;
            }

            // Skontrolujeme, či už produkt existuje v `products`
            const { data: existingProduct, error: selectError } = await supabase
                .from('products')
                .select('id')
                .eq('id', product.id)
                .single();

            if (selectError && selectError.code !== 'PGRST116') {
                console.error("❌ Error fetching product:", selectError);
                continue;
            }

            if (!existingProduct) {
                console.log(`➕ Adding new product: ${product.name}`);
                const { error: insertError } = await supabase
                    .from('products')
                    .insert({ id: product.id, name: product.name, image_url: product.image_url });

                if (insertError) {
                    console.error("❌ Insert error:", insertError);
                    continue;
                }
            }

            // Skontrolujeme existujúce veľkosti pre tento produkt
            const { data: existingSizes, error: sizeSelectError } = await supabase
                .from('product_sizes')
                .select('size, price, status')
                .eq('product_id', product.id);

            if (sizeSelectError) {
                console.error("❌ Error fetching sizes:", sizeSelectError);
                continue;
            }

            const sizeMap = new Map(existingSizes.map(s => [s.size, s]));

            for (const variant of product.sizes) {
                const existingSize = sizeMap.get(variant.size);

                if (existingSize) {
                    // Skontrolujeme, či sa zmenila cena alebo status
                    if (existingSize.price !== variant.price || existingSize.status !== variant.status) {
                        console.log(`🔄 Updating size ${variant.size} for product ${product.name}`);
                        const { error: updateError } = await supabase
                            .from('product_sizes')
                            .update({ price: variant.price, status: variant.status })
                            .eq('product_id', product.id)
                            .eq('size', variant.size);

                        if (updateError) {
                            console.error("❌ Update error:", updateError);
                        } else {
                            console.log(`✅ Updated ${variant.size} for ${product.name}`);
                        }
                    }
                } else {
                    // Veľkosť neexistuje → pridáme ju
                    console.log(`➕ Adding size ${variant.size} for product ${product.name}`);
                    const { error: insertError } = await supabase
                        .from('product_sizes')
                        .insert({ product_id: product.id, size: variant.size, price: variant.price, status: variant.status });

                    if (insertError) {
                        console.error("❌ Insert error:", insertError);
                    } else {
                        console.log(`✅ Added ${variant.size} for ${product.name}`);
                    }
                }
            }
        }

        console.log("🎉 XML Feed successfully imported into Supabase!");
    } catch (error) {
        console.error("❌ Error importing XML feed:", error);
    }
}

importXMLFeed();

