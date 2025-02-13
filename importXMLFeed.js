const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function importXMLFeed() {
    const xmlUrl = "https://raw.githubusercontent.com/jurko22/xml-feed/main/feed.xml";

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

        console.table(products.map(p => ({ id: p.id, name: p.name, sizes: p.sizes.length })));

        if (products.length === 0) {
            console.log("❌ No products found in XML feed.");
            return;
        }

        console.log("📡 Fetching existing products from Supabase...");
        const { data: existingProducts, error: productFetchError } = await supabase
            .from('products')
            .select('id');

        if (productFetchError) {
            console.error("❌ Error fetching products:", productFetchError);
            return;
        }

        const existingProductIds = new Set(existingProducts.map(p => p.id));

        for (const product of products) {
            if (product.id === null) {
                console.warn(`⚠️ Skipping product without valid ID: ${product.name}`);
                continue;
            }

            if (!existingProductIds.has(product.id)) {
                console.log(`➕ Adding new product: ${product.name}`);
                const { error: insertError } = await supabase
                    .from('products')
                    .insert({ id: product.id, name: product.name, image_url: product.image_url });

                if (insertError) {
                    console.error("❌ Insert error:", insertError);
                    continue;
                }
            }
        }

        console.log("📡 Fetching existing product sizes...");
        const { data: existingSizes, error: sizeFetchError } = await supabase
            .from('product_sizes')
            .select('product_id, size, price, status');

        if (sizeFetchError) {
            console.error("❌ Error fetching sizes:", sizeFetchError);
            return;
        }

        const sizeMap = new Map();
        for (const size of existingSizes) {
            const key = `${size.product_id}-${size.size}`;
            sizeMap.set(key, size);
        }

        let sizesToInsert = [];
        let sizesToUpdate = [];

        for (const product of products) {
            for (const variant of product.sizes) {
                const key = `${product.id}-${variant.size}`;
                const existingSize = sizeMap.get(key);

                if (existingSize) {
                    if (existingSize.price !== variant.price || existingSize.status !== variant.status) {
                        sizesToUpdate.push({
                            product_id: product.id,
                            size: variant.size,
                            price: variant.price,
                            status: variant.status
                        });
                    }
                } else {
                    sizesToInsert.push({
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
            const { error: insertSizeError } = await supabase.from('product_sizes').insert(sizesToInsert);
            if (insertSizeError) console.error("❌ Insert error:", insertSizeError);
        }

        if (sizesToUpdate.length > 0) {
            console.log(`🔄 Updating ${sizesToUpdate.length} size records...`);
            for (const size of sizesToUpdate) {
                const { error: updateError } = await supabase
                    .from('product_sizes')
                    .update({ price: size.price, status: size.status })
                    .eq('product_id', size.product_id)
                    .eq('size', size.size);

                if (updateError) console.error("❌ Update error:", updateError);
            }
        }

        console.log("🎉 XML Feed successfully imported into Supabase!");
    } catch (error) {
        console.error("❌ Error importing XML feed:", error);
    }
}

importXMLFeed();


